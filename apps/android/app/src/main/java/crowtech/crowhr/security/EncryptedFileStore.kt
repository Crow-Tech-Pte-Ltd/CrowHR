package crowtech.crowhr.security

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
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
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD(associatedData)
        return cipher.iv + cipher.doFinal(plain)
    }

    override fun decrypt(sealed: ByteArray, associatedData: ByteArray): ByteArray {
        require(sealed.size > 12) { "ciphertext too short" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed, 0, 12))
        cipher.updateAAD(associatedData)
        return cipher.doFinal(sealed, 12, sealed.size - 12)
    }
}

/**
 * The key lives in the Android Keystore (hardware-backed where the device has it), is never
 * exportable and is bound to this device, so the encrypted files are useless anywhere else
 * (mobile-apps spec "Native sign-in and session storage"). It does not require the user to
 * authenticate per use, so the background refresh can run while the phone is locked; the
 * optional biometric lock protects the UI.
 */
class KeystoreCrypter(private val alias: String = ALIAS) : AesGcmCrypter({ keystoreKey(alias) }) {
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
 */
class EncryptedFileStore(private val dir: File, private val crypter: Crypter) : KeyValueStore {
    private val index = File(dir, "index.enc")

    init { dir.mkdirs() }

    private fun fileFor(key: String): File {
        val hash = MessageDigest.getInstance("SHA-256").digest(key.toByteArray()).joinToString("") { "%02x".format(it) }
        return File(dir, "$hash.enc")
    }

    @Synchronized override fun get(key: String): String? {
        val file = fileFor(key)
        if (!file.exists()) return null
        return runCatching { String(crypter.decrypt(file.readBytes(), key.toByteArray()), Charsets.UTF_8) }.getOrNull()
    }

    @Synchronized override fun put(key: String, value: String) {
        writeAtomically(fileFor(key), crypter.encrypt(value.toByteArray(Charsets.UTF_8), key.toByteArray()))
        val keys = keys()
        if (key !in keys) saveIndex(keys + key)
    }

    @Synchronized override fun remove(key: String) {
        fileFor(key).delete()
        val keys = keys()
        if (key in keys) saveIndex(keys - key)
    }

    @Synchronized override fun keys(): Set<String> {
        if (!index.exists()) return emptySet()
        val text = runCatching { String(crypter.decrypt(index.readBytes(), INDEX_AD), Charsets.UTF_8) }.getOrNull() ?: return emptySet()
        return text.split('\n').filter { it.isNotEmpty() }.toSet()
    }

    /** Deletes every file, including ones whose key can no longer be read. */
    @Synchronized override fun clear() {
        dir.listFiles()?.forEach { it.delete() }
    }

    private fun saveIndex(keys: Set<String>) = writeAtomically(index, crypter.encrypt(keys.joinToString("\n").toByteArray(), INDEX_AD))

    private fun writeAtomically(target: File, bytes: ByteArray) {
        val tmp = File(dir, target.name + ".tmp-" + SecureRandom().nextInt(Int.MAX_VALUE))
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(target)) {
            target.delete()
            tmp.renameTo(target)
        }
    }

    private companion object {
        val INDEX_AD = "crowhr.index".toByteArray()
    }
}
