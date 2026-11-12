package crowtech.crowhr.security

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.crypto.KeyGenerator

/**
 * The encrypted store decrypts each value once per process (each decryption is Keystore binder
 * calls, mostly on the main thread) while the files stay encrypted and every change reaches disk.
 */
class EncryptedFileStoreTest {
    private val dir: File = Files.createTempDirectory("crowhr-store").toFile()
    private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

    private class Counting(private val inner: Crypter) : Crypter {
        @Volatile var decrypts = 0
        @Volatile var encrypts = 0
        @Volatile var failEncrypt = false
        override fun encrypt(plain: ByteArray, associatedData: ByteArray): ByteArray {
            if (failEncrypt) throw IOException("disk full")
            encrypts++
            return inner.encrypt(plain, associatedData)
        }
        override fun decrypt(sealed: ByteArray, associatedData: ByteArray): ByteArray {
            decrypts++
            return inner.decrypt(sealed, associatedData)
        }
    }

    private val crypter = Counting(AesGcmCrypter { key })
    private fun store() = EncryptedFileStore(dir, crypter)
    private fun freshStore() = EncryptedFileStore(dir, AesGcmCrypter { key })

    @After fun tearDown() { dir.deleteRecursively() }

    @Test fun eachValueIsDecryptedOncePerProcess() {
        freshStore().put("tokens.a", "access-and-refresh")
        val store = store()
        repeat(20) { assertEquals("access-and-refresh", store.get("tokens.a")) }
        assertEquals(1, crypter.decrypts)
        repeat(5) { assertEquals(setOf("tokens.a"), store.keys()) }
        assertEquals(2, crypter.decrypts) // the value, then the index
        assertNull(store.get("tokens.missing"))
        assertEquals(2, crypter.decrypts) // no file: nothing to decrypt
    }

    @Test fun writesAndRemovalsReachDiskAndAreSeenAtOnce() {
        val store = store()
        store.put("punches.a", "[1]")
        store.put("punches.a", "[1,2]")
        assertEquals("[1,2]", store.get("punches.a"))
        assertEquals(0, crypter.decrypts)
        // Another reader of the files (the next process) sees the same.
        assertEquals("[1,2]", freshStore().get("punches.a"))
        assertEquals(setOf("punches.a"), freshStore().keys())
        store.remove("punches.a")
        assertNull(store.get("punches.a"))
        assertNull(freshStore().get("punches.a"))
        assertTrue(store.keys().isEmpty())
        assertTrue(freshStore().keys().isEmpty())
    }

    @Test fun nothingIsReadableOnDisk() {
        store().put("tokens.a", "refresh-plain-654321")
        val raw = dir.walk().filter { it.isFile }.joinToString("") { it.readBytes().toString(Charsets.ISO_8859_1) }
        assertFalse(raw.contains("refresh-plain-654321"))
        assertFalse(raw.contains("tokens.a"))
        // No temporary files are left behind.
        assertTrue(dir.listFiles()!!.all { it.name.endsWith(".enc") })
    }

    @Test fun clearForgetsEverything() {
        val store = store()
        store.put("tokens.a", "x")
        store.put("cache.a.payslips", "y")
        store.clear()
        assertNull(store.get("tokens.a"))
        assertNull(store.get("cache.a.payslips"))
        assertTrue(store.keys().isEmpty())
        assertTrue(dir.listFiles()!!.isEmpty())
    }

    @Test fun aFileThatFailsToDecryptIsNotRemembered() {
        val store = store()
        store.put("tokens.a", "first")
        val other = EncryptedFileStore(dir, AesGcmCrypter { KeyGenerator.getInstance("AES").apply { init(256) }.generateKey() })
        // Written with another key: unreadable here, so it reads as absent, as before.
        other.put("tokens.b", "elsewhere")
        assertNull(store.get("tokens.b"))
        // Written again with the right key: read now, not stuck as absent.
        freshStore().put("tokens.b", "readable")
        assertEquals("readable", store.get("tokens.b"))
    }

    @Test fun aFailedWriteLeavesTheStoredValue() {
        val store = store()
        store.put("punches.a", "[1]")
        crypter.failEncrypt = true
        try {
            store.put("punches.a", "[1,2]")
            fail("the write should have failed")
        } catch (_: IOException) {
        }
        crypter.failEncrypt = false
        assertEquals("[1]", store.get("punches.a"))
        assertEquals("[1]", freshStore().get("punches.a"))
    }

    @Test fun concurrentReadsAndWritesStayConsistent() {
        val store = store()
        val pool = Executors.newFixedThreadPool(8)
        repeat(200) { i -> pool.execute { store.put("k.${i % 10}", "v$i"); store.get("k.${(i + 3) % 10}") } }
        pool.shutdown()
        assertTrue(pool.awaitTermination(30, TimeUnit.SECONDS))
        val fresh = freshStore()
        (0 until 10).forEach { k -> assertEquals(fresh.get("k.$k"), store.get("k.$k")) }
        assertEquals(fresh.keys(), store.keys())
        assertEquals((0 until 10).map { "k.$it" }.toSet(), store.keys())
    }
}
