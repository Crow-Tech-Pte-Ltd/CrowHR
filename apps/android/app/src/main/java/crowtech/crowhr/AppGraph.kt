package crowtech.crowhr

import android.content.Context
import android.os.Build
import crowtech.crowhr.api.ApiClient
import crowtech.crowhr.api.HttpClients
import crowtech.crowhr.api.OkHttpMetaFetcher
import crowtech.crowhr.auth.BrowserLauncher
import crowtech.crowhr.auth.CustomTabsLauncher
import crowtech.crowhr.auth.NativeAuth
import crowtech.crowhr.auth.TokenStore
import crowtech.crowhr.connect.ConnectCheck
import crowtech.crowhr.connect.ConnectionStore
import crowtech.crowhr.connect.SavedConnection
import crowtech.crowhr.core.LocalCache
import crowtech.crowhr.notify.RefreshScheduler
import crowtech.crowhr.punch.KvPunchStore
import crowtech.crowhr.punch.PunchQueue
import crowtech.crowhr.punch.PunchSync
import crowtech.crowhr.security.AppLock
import crowtech.crowhr.security.EncryptedFileStore
import crowtech.crowhr.security.KeyValueStore
import crowtech.crowhr.security.KeystoreCrypter
import crowtech.crowhr.ui.ReceiptCamera
import crowtech.crowhr.ui.SystemReceiptCamera
import crowtech.crowhr.ui.ScreenMemory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.io.File
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap

/** App-wide settings in the encrypted store. */
class AppSettings(private val kv: KeyValueStore) {
    var notificationsEnabled: Boolean
        get() = kv.get("settings.notifications") != "false"
        set(value) = kv.put("settings.notifications", value.toString())

    fun refreshCursor(connectionKey: String): String? = kv.get("refresh.cursor.$connectionKey")
    fun setRefreshCursor(connectionKey: String, cursor: String?) {
        if (cursor == null) kv.remove("refresh.cursor.$connectionKey") else kv.put("refresh.cursor.$connectionKey", cursor)
    }
}

/**
 * The app's object graph (no DI framework). Everything persisted goes through [store]:
 * Keystore-encrypted files in noBackupFilesDir, excluded from every backup.
 */
class AppGraph private constructor(val context: Context) {
    val store: KeyValueStore = EncryptedFileStore(File(context.noBackupFilesDir, "secure"), KeystoreCrypter())
    val connections = ConnectionStore(store)
    val tokens = TokenStore(store)
    val lock = AppLock(store)
    val settings = AppSettings(store)
    val cache = LocalCache(store)
    val connectCheck = ConnectCheck(OkHttpMetaFetcher())
    val nativeAuth = NativeAuth(
        store, tokens,
        httpFor = { http(it) },
        deviceName = NativeAuth.deviceName(Build.MANUFACTURER, Build.MODEL),
        appVersion = BuildConfig.VERSION_NAME,
        now = { clock() },
    )

    /** Test hooks: the UI tests replace the browser (sign-in) and the camera (receipts). */
    @Volatile var browser: BrowserLauncher = CustomTabsLauncher
    @Volatile var receiptCamera: ReceiptCamera = SystemReceiptCamera
    @Volatile var clock: () -> Instant = Instant::now

    private val _sessionEnded = MutableSharedFlow<String>(extraBufferCapacity = 4)
    /** Emits a connection key when its session ended (revoked on the web, expired, suspended). */
    val sessionEnded: SharedFlow<String> = _sessionEnded

    /**
     * Work that must finish even when its screen goes away: a clock tap (its location wait, the
     * save and the send). A screen's own scope ends when the user switches tab.
     */
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    /** The last content of each tab, in memory only, so a tab shows it again at once. */
    val screenMemory = ScreenMemory()

    private val queues = ConcurrentHashMap<String, PunchQueue>()

    fun http(connection: SavedConnection) = HttpClients.forHost(connection.server.toHttpUrl().host)

    fun api(connection: SavedConnection) = ApiClient(connection, http(connection), tokens, nativeAuth, now = { clock() }) { ended ->
        clearSession(ended, keepPunches = true)
        _sessionEnded.tryEmit(ended.key)
    }

    fun punchQueue(connection: SavedConnection): PunchQueue =
        queues.getOrPut(connection.key) { PunchQueue(KvPunchStore(store, connection.key)) }

    fun isSignedIn(connection: SavedConnection) = tokens.get(connection.key) != null

    /**
     * Ends the session's local data: tokens, cached screens and the refresh cursor. Unsent
     * punches are kept when the session ended by itself (they are sent after the next sign-in)
     * and removed only on an explicit sign-out the user confirmed.
     */
    fun clearSession(connection: SavedConnection, keepPunches: Boolean) {
        tokens.delete(connection.key)
        cache.clear(connection.key)
        screenMemory.clear(connection.key)
        settings.setRefreshCursor(connection.key, null)
        // A payslip PDF handed to a viewer is deleted when its screen closes; this also covers a
        // process that ended while the viewer was open.
        File(context.cacheDir, "share").deleteRecursively()
        if (!keepPunches) {
            store.remove("punches.${connection.key}")
            queues.remove(connection.key)
        }
        if (connections.all().none { isSignedIn(it) }) {
            RefreshScheduler.cancel(context)
            PunchSync.cancel(context)
        }
    }

    suspend fun signOut(connection: SavedConnection) {
        nativeAuth.signOut(connection)
        clearSession(connection, keepPunches = false)
    }

    /** Removing a saved connection signs out of it and deletes everything stored for it. */
    suspend fun removeConnection(connection: SavedConnection) {
        signOut(connection)
        connections.remove(connection.key)
    }

    /** UI tests only: forget every connection, token, cache and queued punch. */
    fun resetForTests() {
        store.clear()
        screenMemory.clearAll()
        queues.clear()
        nativeAuth.cancel()
    }

    companion object {
        // Holds the application context only (never an Activity), so nothing leaks.
        @android.annotation.SuppressLint("StaticFieldLeak")
        @Volatile private var instance: AppGraph? = null

        fun get(context: Context): AppGraph = instance ?: synchronized(this) {
            instance ?: AppGraph(context.applicationContext).also { instance = it }
        }
    }
}
