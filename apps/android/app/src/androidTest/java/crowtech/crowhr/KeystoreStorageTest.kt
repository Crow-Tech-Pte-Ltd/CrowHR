package crowtech.crowhr

import android.content.pm.ApplicationInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import crowtech.crowhr.auth.StoredTokens
import crowtech.crowhr.auth.TokenStore
import crowtech.crowhr.security.EncryptedFileStore
import crowtech.crowhr.security.KeystoreCrypter
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.KeyStore
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import android.security.keystore.KeyInfo

/**
 * Task 2.3, on a device: tokens are encrypted with an Android Keystore key that can't be
 * exported, the files are unreadable without it, and the installed app has backup off.
 */
@RunWith(AndroidJUnit4::class)
class KeystoreStorageTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val alias = "crowhr.test-key"
    private val dir = File(context.noBackupFilesDir, "keystore-test")

    @After fun tearDown() {
        dir.deleteRecursively()
        KeystoreCrypter.deleteKey(alias)
    }

    @Test fun tokensAreEncryptedWithANonExportableKeystoreKey() {
        val store = EncryptedFileStore(dir, KeystoreCrypter(alias))
        val tokens = TokenStore(store)
        tokens.put("https://hr.example.com|acme", StoredTokens("access-plain-123456", "refresh-plain-654321", "device-1"))
        assertEquals("access-plain-123456", tokens.get("https://hr.example.com|acme")!!.accessToken)

        val raw = dir.walk().filter { it.isFile }.joinToString("") { it.readBytes().toString(Charsets.ISO_8859_1) }
        assertFalse(raw.contains("access-plain-123456"))
        assertFalse(raw.contains("refresh-plain-654321"))
        assertFalse(raw.contains("hr.example.com"))

        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val key = ks.getKey(alias, null) as SecretKey
        assertNull("Keystore keys never expose their material", key.encoded)
        val info = SecretKeyFactory.getInstance(key.algorithm, "AndroidKeyStore").getKeySpec(key, KeyInfo::class.java) as KeyInfo
        assertEquals(256, info.keySize)
        assertFalse(info.isUserAuthenticationRequired)

        // Without the key (another device, or after the key is deleted) nothing can be read.
        KeystoreCrypter.deleteKey(alias)
        assertNull(TokenStore(EncryptedFileStore(dir, KeystoreCrypter(alias))).get("https://hr.example.com|acme"))
    }

    @Test fun installedAppHasBackupOff() {
        val info = context.packageManager.getApplicationInfo(context.packageName, 0)
        assertEquals(0, info.flags and ApplicationInfo.FLAG_ALLOW_BACKUP)
        assertTrue(info.dataDir.isNotEmpty())
    }
}
