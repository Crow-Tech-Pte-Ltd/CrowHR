package crowtech.crowhr.security

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.io.FileOutputStream
import java.security.InvalidKeyException
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Authenticated encryption of small blobs. */
interface Crypter {
    fun encrypt(plain: ByteArray, associatedData: ByteArray): ByteArray
    fun decrypt(sealed: ByteArray, associatedData: ByteArray): ByteArray
}

/** AES-256-GCM with a random 12-byte IV prefixed to the ciphertext. */
open class AesGcmCrypter(private val key: () -> SecretKey) : Crypter {
    override fun encrypt(plain: ByteArray, associatedData: ByteArray): ByteArray {
        val cipher = initialised { c, k -> c.init(Cipher.ENCRYPT_MODE, k) }
        cipher.updateAAD(associatedData)
        return cipher.iv + cipher.doFinal(plain)
    }

    override fun decrypt(sealed: ByteArray, associatedData: ByteArray): ByteArray {
        require(sealed.size > 12) { "ciphertext too short" }
        val cipher = initialised { c, k -> c.init(Cipher.DECRYPT_MODE, k, GCMParameterSpec(128, sealed, 0, 12)) }
        cipher.updateAAD(associatedData)
        return cipher.doFinal(sealed, 12, sealed.size - 12)
    }

    private fun initialised(init: (Cipher, SecretKey) -> Unit): Cipher {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        try {
            init(cipher, key())
        } catch (e: InvalidKeyException) {
            // A remembered key handle the Keystore no longer accepts: look it up again, once.
            if (!keyRejected()) throw e
            init(cipher, key())
        }
        return cipher
    }

    /** The key was refused; true when a fresh lookup should be tried. */
    protected open fun keyRejected(): Boolean = false
}

/**
 * The key lives in the Android Keystore (hardware-backed where the device has it), is never
 * exportable and is bound to this device, so the encrypted files are useless anywhere else
 * (mobile-apps spec "Native sign-in and session storage"). It does not require the user to
 * authenticate per use, so the background refresh can run while the phone is locked; the
 * optional biometric lock protects the UI.
 *
 * The key handle is looked up once and then reused (each lookup is several binder calls into the
 * Keystore). It is only a reference: the key material never leaves the Keystore.
 */
class KeystoreCrypter private constructor(private val handle: KeyHandle) : AesGcmCrypter(handle::get) {
    constructor(alias: String = ALIAS) : this(KeyHandle(alias))

    override fun keyRejected(): Boolean {
        handle.forget()
        return true
    }

    private class KeyHandle(private val alias: String) {
        @Volatile private var key: SecretKey? = null
        fun get(): SecretKey = key ?: keystoreKey(alias).also { key = it }
        fun forget() { key = null }
    }

    companion object {
        const val ALIAS = "crowhr.local-data.v1"

        @Synchronized
        fun keystoreKey(alias: String): SecretKey {
            val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            (ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
            val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            generator.init(
                KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .setRandomizedEncryptionRequired(true)
                    .build(),
            )
            return generator.generateKey()
        }

        fun deleteKey(alias: String = ALIAS) {
            val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            if (ks.containsAlias(alias)) ks.deleteEntry(alias)
        }
    }
}

/**
 * [KeyValueStore] where every value is its own encrypted file in [dir] (the app's
 * noBackupFilesDir). File names are hashes of the keys; the key is bound in as associated data
 * so a file can't be swapped for another. Unreadable files read as absent.
 *
 * Each value is decrypted once per process, then served from memory (read-through, updated by
 * [put] and dropped by [remove] and [clear]): a decryption is several Keystore binder calls, and
 * most reads are on the main thread (every request reads the tokens, the Clock screen the
 * queue). The files on disk stay encrypted. Memory holds only values the app has read or
 * written, for as long as they are stored (signing out removes them), as the app already held
 * them decrypted while using them. A file that fails to decrypt is not remembered, so the next
 * read tries again. The app has one store per process, so it is the only writer.
 */
class EncryptedFileStore(private val dir: File, private val crypter: Crypter) : KeyValueStore {
    private val index = File(dir, "index.enc")
    private val values = HashMap<String, String>()
    private var indexKeys: Set<String>? = null

    init { dir.mkdirs() }

    private fun fileFor(key: String): File {
        val hash = MessageDigest.getInstance("SHA-256").digest(key.toByteArray()).joinToString("") { "%02x".format(it) }
        return File(dir, "$hash.enc")
    }

    @Synchronized override fun get(key: String): String? {
        values[key]?.let { return it }
        val file = fileFor(key)
        if (!file.exists()) return null
        val value = runCatching { String(crypter.decrypt(file.readBytes(), key.toByteArray()), Charsets.UTF_8) }.getOrNull()
        if (value != null) values[key] = value
        return value
    }

    @Synchronized override fun put(key: String, value: String) {
        // Forgotten until the write succeeded: a failed write must not leave memory ahead of disk.
        values.remove(key)
        writeAtomically(fileFor(key), crypter.encrypt(value.toByteArray(Charsets.UTF_8), key.toByteArray()))
        values[key] = value
        val keys = keys()
        if (key !in keys) saveIndex(keys + key)
    }

    @Synchronized override fun remove(key: String) {
        values.remove(key)
        fileFor(key).delete()
        val keys = keys()
        if (key in keys) saveIndex(keys - key)
    }

    @Synchronized override fun keys(): Set<String> {
        indexKeys?.let { return it }
        if (!index.exists()) return emptySet()
        val text = runCatching { String(crypter.decrypt(index.readBytes(), INDEX_AD), Charsets.UTF_8) }.getOrNull() ?: return emptySet()
        return text.split('\n').filter { it.isNotEmpty() }.toSet().also { indexKeys = it }
    }

    /** Deletes every file, including ones whose key can no longer be read. */
    @Synchronized override fun clear() {
        values.clear()
        indexKeys = null
        dir.listFiles()?.forEach { it.delete() }
    }

    private fun saveIndex(keys: Set<String>) {
        indexKeys = null
        writeAtomically(index, crypter.encrypt(keys.joinToString("\n").toByteArray(), INDEX_AD))
        indexKeys = keys
    }

    /**
     * Written to a temporary file, flushed to the storage device, then renamed over the old one.
     * Without the flush a power cut shortly after a write could leave the renamed file empty or
     * short, which reads as absent: no tokens, or an empty punch queue.
     */
    private fun writeAtomically(target: File, bytes: ByteArray) {
        val tmp = File(dir, target.name + ".tmp-" + SecureRandom().nextInt(Int.MAX_VALUE))
        FileOutputStream(tmp).use { out ->
            out.write(bytes)
            out.fd.sync()
        }
        if (!tmp.renameTo(target)) {
            target.delete()
            tmp.renameTo(target)
        }
    }

    private companion object {
        val INDEX_AD = "crowhr.index".toByteArray()
    }
}
