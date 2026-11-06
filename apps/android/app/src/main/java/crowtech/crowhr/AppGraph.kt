package crowtech.crowhr

import android.content.Context
import crowtech.crowhr.api.OkHttpMetaFetcher
import crowtech.crowhr.connect.ConnectCheck
import crowtech.crowhr.connect.ConnectionStore
import crowtech.crowhr.security.EncryptedFileStore
import crowtech.crowhr.security.KeystoreCrypter
import crowtech.crowhr.security.KeyValueStore
import java.io.File

/**
 * The app's object graph (no DI framework). Everything that is persisted goes through [store]:
 * Keystore-encrypted files in noBackupFilesDir.
 */
class AppGraph private constructor(val context: Context) {
    val store: KeyValueStore = EncryptedFileStore(File(context.noBackupFilesDir, "secure"), KeystoreCrypter())
    val connections = ConnectionStore(store)
    val connectCheck = ConnectCheck(OkHttpMetaFetcher())

    companion object {
        @Volatile private var instance: AppGraph? = null

        fun get(context: Context): AppGraph = instance ?: synchronized(this) {
            instance ?: AppGraph(context.applicationContext).also { instance = it }
        }
    }
}
