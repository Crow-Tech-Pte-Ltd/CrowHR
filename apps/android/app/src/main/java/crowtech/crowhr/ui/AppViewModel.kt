package crowtech.crowhr.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import crowtech.crowhr.AppGraph
import crowtech.crowhr.api.Me
import crowtech.crowhr.api.OfflineException
import crowtech.crowhr.auth.SignInResult
import crowtech.crowhr.connect.ConnectOutcome
import crowtech.crowhr.connect.SavedConnection
import crowtech.crowhr.notify.RefreshScheduler
import crowtech.crowhr.punch.PunchSync
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface RootScreen {
    /** First run, or adding another connection ([returnTo] = where Cancel goes). */
    data class Connect(val returnTo: SavedConnection? = null) : RootScreen
    /** [busy]: the browser is open; [finishing]: it came back and the code is being exchanged. */
    data class SignIn(val connection: SavedConnection, val message: String? = null, val busy: Boolean = false, val finishing: Boolean = false) : RootScreen
    data class Main(val connection: SavedConnection, val me: Me? = null) : RootScreen
}

/** Top-level navigation: connect → sign in → main, plus session end and the biometric lock. */
class AppViewModel(private val graph: AppGraph) : ViewModel() {
    private val _root = MutableStateFlow(initial())
    val root: StateFlow<RootScreen> = _root.asStateFlow()

    private val _locked = MutableStateFlow(graph.lock.shouldLock(graph.clock()))
    val locked: StateFlow<Boolean> = _locked.asStateFlow()

    /** "approvals" or "notifications" when opened from the local notification. */
    val openRequest = MutableStateFlow<String?>(null)

    /** A `crowhr://connect` link (QR code opened with the camera app, or a tapped link). */
    val connectLink = MutableStateFlow<String?>(null)

    fun onConnectLink(uri: String) {
        connectLink.value = uri
        if (root.value !is RootScreen.Connect) addConnection()
    }

    init {
        viewModelScope.launch {
            graph.sessionEnded.collect { key ->
                val current = _root.value
                if (current is RootScreen.Main && current.connection.key == key) {
                    _root.value = RootScreen.SignIn(current.connection, "Your session has ended (for example, it was signed out on the web). Sign in again.")
                }
            }
        }
        (root.value as? RootScreen.Main)?.let { onSignedIn(it.connection) }
    }

    private fun initial(): RootScreen {
        val active = graph.connections.active() ?: graph.connections.all().firstOrNull()?.also { graph.connections.switchTo(it.key) }
        return when {
            active == null -> RootScreen.Connect()
            graph.isSignedIn(active) -> RootScreen.Main(active)
            else -> RootScreen.SignIn(active)
        }
    }

    fun onConnected(connection: SavedConnection) {
        _root.value = if (graph.isSignedIn(connection)) RootScreen.Main(connection).also { onSignedIn(connection) } else RootScreen.SignIn(connection)
    }

    fun addConnection() {
        _root.value = RootScreen.Connect(returnTo = (root.value as? RootScreen.Main)?.connection ?: (root.value as? RootScreen.SignIn)?.connection)
    }

    fun cancelAdd() {
        val back = (root.value as? RootScreen.Connect)?.returnTo ?: return
        graph.connections.switchTo(back.key)
        onConnected(back)
    }

    fun switchTo(connection: SavedConnection) {
        graph.connections.switchTo(connection.key)
        onConnected(connection)
    }

    fun startSignIn(context: Context) {
        val screen = root.value as? RootScreen.SignIn ?: return
        val url = graph.nativeAuth.begin(screen.connection)
        if (graph.browser.open(context, url)) {
            _root.value = screen.copy(message = null, busy = true)
        } else {
            graph.nativeAuth.cancel()
            _root.value = screen.copy(message = "No web browser is installed. Install or enable a browser to sign in.", busy = false)
        }
    }

    /**
     * The app is in front again. A sign-in redirect arrives before this (onNewIntent comes before
     * onResume), so still waiting here means the browser was closed without finishing: show
     * Sign in again instead of a spinner that only Cancel would stop. The pending sign-in is
     * kept, so a late redirect from that browser still completes.
     */
    fun onResumed() {
        val screen = root.value as? RootScreen.SignIn ?: return
        if (screen.busy && !screen.finishing) _root.value = screen.copy(busy = false)
    }

    fun stopWaiting() {
        val screen = root.value as? RootScreen.SignIn ?: return
        _root.value = screen.copy(busy = false)
    }

    fun onRedirect(uri: String) {
        (root.value as? RootScreen.SignIn)?.let { _root.value = it.copy(message = null, busy = true, finishing = true) }
        viewModelScope.launch {
            when (val result = graph.nativeAuth.complete(uri) { key -> graph.connections.all().firstOrNull { it.key == key } }) {
                is SignInResult.Success -> {
                    val connection = graph.connections.all().first { it.key == result.connectionKey }
                    graph.connections.switchTo(connection.key)
                    _root.value = RootScreen.Main(connection)
                    onSignedIn(connection)
                }
                is SignInResult.Failed -> when (val current = root.value) {
                    is RootScreen.SignIn -> _root.value = RootScreen.SignIn(current.connection, result.message)
                    // A stale or repeated redirect (Back in the browser, a second tap) while
                    // already signed in: the session is fine, so stay where the user is.
                    is RootScreen.Main -> Unit
                    is RootScreen.Connect -> graph.connections.active()
                        ?.takeUnless { graph.isSignedIn(it) }
                        ?.let { _root.value = RootScreen.SignIn(it, result.message) }
                }
            }
        }
    }

    private fun onSignedIn(connection: SavedConnection) {
        RefreshScheduler.schedule(graph.context)
        viewModelScope.launch {
            refreshMeta(connection)
            try {
                val me = graph.api(connection).get("/api/v1/me", Me.serializer())
                val current = _root.value
                if (current is RootScreen.Main && current.connection.key == connection.key) _root.value = current.copy(me = me)
            } catch (_: OfflineException) {
            } catch (_: Exception) {
            }
            if (graph.punchQueue(connection).pending().isNotEmpty()) PunchSync.request(graph.context)
        }
    }

    /** Servers upgrade: re-read meta so newly enabled screens appear (and removed ones hide). */
    private suspend fun refreshMeta(connection: SavedConnection) {
        val outcome = runCatching { graph.connectCheck.check(connection.server, connection.orgSlug) }.getOrNull() as? ConnectOutcome.Ok ?: return
        val updated = connection.copy(
            displayName = outcome.org.displayName, logoUrl = outcome.org.logoUrl, features = outcome.features,
            signInMethods = outcome.org.signInMethods, demo = outcome.demo,
        )
        if (updated != connection) {
            graph.connections.update(updated)
            val current = _root.value
            if (current is RootScreen.Main && current.connection.key == connection.key) _root.value = current.copy(connection = updated)
        }
    }

    fun signOut(connection: SavedConnection) {
        viewModelScope.launch {
            graph.signOut(connection)
            _root.value = RootScreen.SignIn(connection, "You're signed out. Your data was removed from this phone.")
        }
    }

    fun removeConnection(connection: SavedConnection) {
        viewModelScope.launch {
            graph.removeConnection(connection)
            _root.value = initial()
        }
    }

    // --- Biometric lock ---
    fun onBackground() = graph.lock.onBackground(graph.clock())
    fun onForeground() { _locked.value = graph.lock.shouldLock(graph.clock()) }
    fun onUnlocked() {
        graph.lock.onUnlocked()
        _locked.value = false
    }
}
