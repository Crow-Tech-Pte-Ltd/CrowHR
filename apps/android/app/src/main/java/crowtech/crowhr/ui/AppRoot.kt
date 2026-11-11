package crowtech.crowhr.ui

import android.app.Activity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import crowtech.crowhr.AppGraph
import crowtech.crowhr.connect.ConnectScreen
import crowtech.crowhr.connect.ConnectViewModel
import crowtech.crowhr.connect.LocalNetwork
import crowtech.crowhr.connect.OrganisationLogo
import crowtech.crowhr.connect.SavedConnection
import crowtech.crowhr.security.Biometric
import crowtech.crowhr.ui.components.CrowCard
import crowtech.crowhr.ui.components.Label
import crowtech.crowhr.ui.components.LinkButton
import crowtech.crowhr.ui.components.Notice
import crowtech.crowhr.ui.components.PrimaryButton
import crowtech.crowhr.ui.components.ScreenTitle
import crowtech.crowhr.ui.components.SecondaryButton
import crowtech.crowhr.ui.components.Tone
import crowtech.crowhr.ui.theme.Crow

@Composable
fun AppRoot(graph: AppGraph, vm: AppViewModel) {
    val root by vm.root.collectAsState()
    val locked by vm.locked.collectAsState()
    // The main screens' saved state (back stack, half-filled forms) outlives the lock screen.
    val shells = rememberSaveableStateHolder()
    // A lock the phone can't enforce (its screen lock was removed) would lock the user out.
    if (locked && Biometric.available(LocalContext.current)) {
        LockScreen(vm::onUnlocked)
        return
    }
    when (val screen = root) {
        is RootScreen.Connect -> SinglePane {
            val connectVm: ConnectViewModel = viewModel(key = "connect-${screen.returnTo?.key}") {
                ConnectViewModel(graph.connectCheck, graph.connections) { host -> LocalNetwork.allowed(graph.context, host) }
            }
            val link by vm.connectLink.collectAsState()
            androidx.compose.runtime.LaunchedEffect(link) {
                link?.let { connectVm.onLink(it); vm.connectLink.value = null }
            }
            ConnectScreen(connectVm, onConnected = vm::onConnected, onCancel = screen.returnTo?.let { { vm.cancelAdd() } })
        }
        is RootScreen.SignIn -> SinglePane {
            SignInScreen(
                screen = screen,
                pendingPunches = graph.punchQueue(screen.connection).pending().size,
                others = graph.connections.all().filter { it.key != screen.connection.key },
                onSignIn = vm::startSignIn,
                onStopWaiting = vm::stopWaiting,
                onSwitch = vm::switchTo,
                onAdd = vm::addConnection,
                onRemove = { vm.removeConnection(screen.connection) },
            )
        }
        is RootScreen.Main -> shells.SaveableStateProvider("main:${screen.connection.key}") { MainShell(graph, vm, screen) }
    }
}

/** A centred, scrollable single column, max 560 dp wide (phones and tablets). */
@Composable
fun SinglePane(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().safeDrawingPadding().imePadding(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 560.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 24.dp),
        ) { content() }
    }
}

@Composable
private fun SignInScreen(
    screen: RootScreen.SignIn,
    pendingPunches: Int,
    others: List<SavedConnection>,
    onSignIn: (android.content.Context) -> Unit,
    onStopWaiting: () -> Unit,
    onSwitch: (SavedConnection) -> Unit,
    onAdd: () -> Unit,
    onRemove: () -> Unit,
) {
    val context = LocalContext.current
    val c = screen.connection
    var confirmRemove by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        ScreenTitle("Sign in", "You'll sign in on your company's Crow HR page in your browser. The app never sees your password.")
        CrowCard {
            OrganisationLogo(c.server, c.logoUrl, c.displayName)
            Text(c.displayName, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 8.dp))
            Text(c.server, style = MaterialTheme.typography.bodyMedium, color = Crow.colors.muted)
            Label("Sign-in methods", Modifier.padding(top = 12.dp))
            Text(c.signInMethods.joinToString(", ") { it.displayName }.ifEmpty { "Set by your organisation" }, style = MaterialTheme.typography.bodyMedium)
        }
        if (c.insecure) Notice("This connection is not encrypted. Only sign in on your company's own network.", Tone.Warning, title = "Not encrypted")
        if (c.demo) Notice("This is a demo server with fictional data. Single sign-on buttons are shown but disabled in demo mode.", Tone.Neutral)
        if (pendingPunches > 0) {
            Notice("$pendingPunches clock-in${if (pendingPunches == 1) " is" else "s are"} saved on this phone and will be sent after you sign in.", Tone.Accent)
        }
        screen.message?.let { Notice(it, Tone.Neutral) }
        PrimaryButton(
            if (screen.busy) "Waiting for the browser…" else "Sign in",
            { onSignIn(context) },
            Modifier.fillMaxWidth().testTag("sign-in"),
            loading = screen.busy,
        )
        if (screen.busy) SecondaryButton("Cancel", onStopWaiting, Modifier.fillMaxWidth())
        if (others.isNotEmpty()) Label("Other connections", Modifier.padding(top = 8.dp))
        others.forEach { other -> SecondaryButton("Switch to ${other.displayName}", { onSwitch(other) }, Modifier.fillMaxWidth()) }
        LinkButton("Add another connection", onAdd)
        if (confirmRemove) {
            Notice("Remove ${c.displayName} from this phone? You can add it again later.", Tone.Warning)
            SecondaryButton("Remove connection", onRemove, Modifier.fillMaxWidth(), tone = Tone.Danger)
        } else {
            LinkButton("Remove this connection", { confirmRemove = true })
        }
    }
}

@Composable
private fun LockScreen(onUnlocked: () -> Unit) {
    val activity = androidx.activity.compose.LocalActivity.current ?: return
    var message by remember { mutableStateOf<String?>(null) }
    val unlock = { Biometric.prompt(activity, onSuccess = onUnlocked, onFailure = { message = it }) }
    // Ask straight away, as iOS does; the button is there after a cancel or a failure.
    androidx.compose.runtime.LaunchedEffect(Unit) { unlock() }
    SinglePane {
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            ScreenTitle("Crow HR is locked", "Unlock with your fingerprint, face or screen lock.")
            message?.let { Notice(it, Tone.Warning) }
            PrimaryButton("Unlock", unlock, Modifier.fillMaxWidth().testTag("unlock"))
        }
    }
}
