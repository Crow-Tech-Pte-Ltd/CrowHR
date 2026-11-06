package crowtech.crowhr.connect

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

sealed interface ConnectPhase {
    data object Idle : ConnectPhase
    data object Checking : ConnectPhase
    /** Android 17+: the server is on the local network and the app must ask for access first. */
    data object NeedsLocalNetwork : ConnectPhase
    /** Show the organisation and ask the user to confirm; [warning] for unencrypted HTTP. */
    data class Confirm(val outcome: ConnectOutcome.Ok, val warning: String?) : ConnectPhase
    data class Failed(val code: String, val message: String) : ConnectPhase
    data class Connected(val connection: SavedConnection) : ConnectPhase
}

data class ConnectUiState(
    val address: String = "",
    val org: String? = null,
    val phase: ConnectPhase = ConnectPhase.Idle,
)

/** First-run and "Add connection": address or QR → meta check → confirm → saved. */
class ConnectViewModel(
    private val check: ConnectCheck,
    private val store: ConnectionStore,
    /** False when [host] is on the local network and the app may not reach it yet (Android 17+). */
    private val localNetworkAllowed: (host: String) -> Boolean = { true },
) : ViewModel() {
    private val _state = MutableStateFlow(ConnectUiState())
    val state: StateFlow<ConnectUiState> = _state.asStateFlow()
    private var job: Job? = null

    fun onAddressChange(value: String) = _state.update { it.copy(address = value, org = null, phase = ConnectPhase.Idle) }

    fun submit() {
        val current = _state.value
        val address = ServerAddress.normalize(current.address)
        if (address is ServerAddress.Result.Ok && !localNetworkAllowed(address.host)) {
            _state.update { it.copy(phase = ConnectPhase.NeedsLocalNetwork) }
            return
        }
        job?.cancel()
        _state.update { it.copy(phase = ConnectPhase.Checking) }
        job = viewModelScope.launch {
            val outcome = check.check(current.address, current.org)
            _state.update {
                it.copy(
                    phase = when (outcome) {
                        is ConnectOutcome.Ok -> ConnectPhase.Confirm(outcome, if (outcome.insecure) ConnectMessages.insecureWarning else null)
                        is ConnectOutcome.Failed -> ConnectPhase.Failed(outcome.code, outcome.message)
                    },
                )
            }
        }
    }

    /** A scanned QR code or an opened `crowhr://connect` link. */
    fun onLink(uri: String) {
        when (val link = DeepLinks.parseConnect(uri)) {
            is DeepLinks.Connect.Ok -> {
                _state.update { it.copy(address = link.server, org = link.org) }
                submit()
            }
            DeepLinks.Connect.Invalid -> _state.update {
                it.copy(phase = ConnectPhase.Failed("invalid_qr", ConnectMessages.forCode("invalid_qr")))
            }
        }
    }

    fun confirm() {
        val confirm = _state.value.phase as? ConnectPhase.Confirm ?: return
        val o = confirm.outcome
        val connection = SavedConnection(
            server = o.server,
            orgSlug = o.org.slug,
            displayName = o.org.displayName,
            logoUrl = o.org.logoUrl,
            insecure = o.insecure,
            features = o.features,
            signInMethods = o.org.signInMethods,
            demo = o.demo,
        )
        val phase = when (store.add(connection)) {
            ConnectionStore.Result.TooMany -> ConnectPhase.Failed("too_many_connections", ConnectMessages.forCode("too_many_connections"))
            else -> ConnectPhase.Connected(connection)
        }
        _state.update { it.copy(phase = phase) }
    }

    fun back() = _state.update { it.copy(phase = ConnectPhase.Idle) }

    fun localNetworkDenied() = _state.update {
        it.copy(phase = ConnectPhase.Failed("local_network_denied", ConnectMessages.forCode("local_network_denied")))
    }
}
