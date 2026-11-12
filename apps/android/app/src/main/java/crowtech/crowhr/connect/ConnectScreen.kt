package crowtech.crowhr.connect

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import crowtech.crowhr.ui.components.CrowCard
import crowtech.crowhr.ui.components.Label
import crowtech.crowhr.ui.components.LinkButton
import crowtech.crowhr.ui.components.LoadingState
import crowtech.crowhr.ui.components.Notice
import crowtech.crowhr.ui.components.PrimaryButton
import crowtech.crowhr.ui.components.ScreenTitle
import crowtech.crowhr.ui.components.SecondaryButton
import crowtech.crowhr.ui.components.Tone
import crowtech.crowhr.ui.theme.Crow

@Composable
fun ConnectScreen(
    vm: ConnectViewModel,
    onConnected: (SavedConnection) -> Unit,
    onCancel: (() -> Unit)? = null,
) {
    val state by vm.state.collectAsState()
    var scanning by remember { mutableStateOf(false) }
    val localNetwork = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) vm.submit() else vm.localNetworkDenied()
    }
    LaunchedEffect(state.phase) {
        (state.phase as? ConnectPhase.Connected)?.let { onConnected(it.connection) }
        if (state.phase == ConnectPhase.NeedsLocalNetwork) localNetwork.launch(LocalNetwork.PERMISSION)
    }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        ScreenTitle(
            "Connect to your company",
            "Crow HR talks only to your company's own server. Nothing is sent to Crow Tech.",
        )
        when (val phase = state.phase) {
            is ConnectPhase.Confirm -> ConfirmOrganisation(phase, vm::confirm, vm::back)
            ConnectPhase.Checking -> LoadingState("Checking the server…")
            ConnectPhase.NeedsLocalNetwork -> Notice(
                "Your company's server is on this local network. Android asks you to allow Crow HR to reach it.",
                Tone.Neutral,
                title = "Local network access",
            )
            else -> {
                if (scanning) {
                    QrScanner(
                        onResult = { scanning = false; vm.onLink(it) },
                        onCancel = { scanning = false },
                    )
                } else {
                    PrimaryButton("Scan QR code", { scanning = true }, Modifier.fillMaxWidth().testTag("scan-qr"))
                    Text(
                        "In Crow HR on the web, open My profile → Mobile app to show the code.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Crow.colors.muted,
                    )
                    Label("Or enter the server address", Modifier.padding(top = 8.dp))
                    OutlinedTextField(
                        value = state.address,
                        onValueChange = vm::onAddressChange,
                        label = { Text("Server address") },
                        placeholder = { Text("hr.yourcompany.com") },
                        singleLine = true,
                        isError = phase is ConnectPhase.Failed,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go, autoCorrectEnabled = false),
                        keyboardActions = KeyboardActions(onGo = { vm.submit() }),
                        modifier = Modifier.fillMaxWidth().testTag("server-address"),
                    )
                    if (state.needsOrg) {
                        // Same as iOS: a server hosting several organisations needs the organisation's ID.
                        Label("Organisation ID", Modifier.padding(top = 8.dp))
                        OutlinedTextField(
                            value = state.org,
                            onValueChange = vm::onOrgChange,
                            label = { Text("Organisation ID") },
                            placeholder = { Text("your-company") },
                            singleLine = true,
                            // The URI keyboard, like the address: no autocorrect or capitals in an ID.
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Uri,
                                imeAction = ImeAction.Go,
                                autoCorrectEnabled = false,
                                capitalization = KeyboardCapitalization.None,
                            ),
                            keyboardActions = KeyboardActions(onGo = { vm.submit() }),
                            modifier = Modifier.fillMaxWidth().testTag("organisation-id"),
                        )
                        Text(
                            "This server hosts several organisations. Enter your organisation's ID from HR (for a demo company, its company code), or scan the QR code.",
                            style = MaterialTheme.typography.bodySmall,
                            color = Crow.colors.muted,
                        )
                    }
                    if (phase is ConnectPhase.Failed) Notice(phase.message, Tone.Danger)
                    SecondaryButton("Check address", vm::submit, Modifier.fillMaxWidth().testTag("check-address"), enabled = state.address.isNotBlank())
                }
                if (onCancel != null) LinkButton("Cancel", onCancel)
            }
        }
    }
}

@Composable
private fun ConfirmOrganisation(phase: ConnectPhase.Confirm, onConfirm: () -> Unit, onBack: () -> Unit) {
    val o = phase.outcome
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        CrowCard {
            Label("Organisation")
            OrganisationLogo(o.server, o.org.logoUrl, o.org.displayName, Modifier.padding(top = 8.dp))
            Text(o.org.displayName, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 8.dp))
            Text(o.server, style = MaterialTheme.typography.bodyMedium, color = Crow.colors.muted)
            if (o.demo) Text("Demo company with fictional data", style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted, modifier = Modifier.testTag("demo-label"))
            Label("Sign in with", Modifier.padding(top = 16.dp))
            Text(o.org.signInMethods.joinToString(", ") { it.displayName }, style = MaterialTheme.typography.bodyMedium)
        }
        if (phase.warning != null) Notice(phase.warning, Tone.Warning, title = "Not encrypted")
        o.featureNotices.forEach { Notice(it, Tone.Neutral) }
        Text("Is this your company? Only connect to the address HR gave you.", style = MaterialTheme.typography.bodyMedium)
        PrimaryButton(
            if (phase.warning != null) "Connect without encryption" else "Connect",
            onConfirm,
            Modifier.fillMaxWidth().testTag("confirm-connect"),
        )
        SecondaryButton("Back", onBack, Modifier.fillMaxWidth())
    }
}
