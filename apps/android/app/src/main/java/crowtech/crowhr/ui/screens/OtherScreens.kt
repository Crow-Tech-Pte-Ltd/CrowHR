package crowtech.crowhr.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import crowtech.crowhr.BuildConfig
import crowtech.crowhr.api.AppNotification
import crowtech.crowhr.api.Me
import crowtech.crowhr.api.NotificationPage
import crowtech.crowhr.api.Profile
import crowtech.crowhr.api.UnreadCount
import crowtech.crowhr.connect.AppScreen
import crowtech.crowhr.core.Formats
import crowtech.crowhr.security.Biometric
import crowtech.crowhr.ui.Route
import crowtech.crowhr.ui.ScreenContext
import crowtech.crowhr.ui.components.CrowCard
import crowtech.crowhr.ui.components.CrowIcons
import crowtech.crowhr.ui.components.EmptyState
import crowtech.crowhr.ui.components.Hairline
import crowtech.crowhr.ui.components.KeyValueRow
import crowtech.crowhr.ui.components.Label
import crowtech.crowhr.ui.components.LinkButton
import crowtech.crowhr.ui.components.LoadContent
import crowtech.crowhr.ui.components.LoadState
import crowtech.crowhr.ui.components.Notice
import crowtech.crowhr.ui.components.ScreenTitle
import crowtech.crowhr.ui.components.SecondaryButton
import crowtech.crowhr.ui.components.SectionTitle
import crowtech.crowhr.ui.components.Tone
import crowtech.crowhr.ui.components.rememberLoader
import crowtech.crowhr.ui.components.userMessage
import crowtech.crowhr.ui.theme.Crow
import crowtech.crowhr.ui.theme.Numeric
import kotlinx.coroutines.launch

@Composable
private fun MenuRow(title: String, detail: String? = null, tag: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(role = Role.Button, onClick = onClick).padding(vertical = 8.dp).testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted) }
        }
        Icon(CrowIcons.Chevron, contentDescription = null, tint = Crow.colors.muted, modifier = Modifier.size(18.dp))
    }
    Hairline()
}

@Composable
fun MoreScreen(ctx: ScreenContext) {
    val unread by produceState<Int?>(null, ctx.connection.key) {
        value = runCatching { ctx.api.get("/api/v1/notifications/unread-count", UnreadCount.serializer()).unread }.getOrNull()
    }
    Column {
        ScreenTitle("More")
        if (ctx.connection.isAvailable(AppScreen.Notifications)) {
            MenuRow("Notifications", unread?.let { if (it == 0) "Nothing new" else "$it unread" }, "more-notifications") { ctx.push(Route.Notifications) }
        }
        if (ctx.connection.isAvailable(AppScreen.Claims)) MenuRow("Claims", "Expenses with receipt photos", "more-claims") { ctx.push(Route.Claims) }
        if (ctx.connection.isAvailable(AppScreen.Schedule)) MenuRow("My schedule", "Published shifts", "more-schedule") { ctx.push(Route.Schedule) }
        MenuRow("My profile", "Read-only; changes are made on the web", "more-profile") { ctx.push(Route.Profile) }
        MenuRow("Settings", "Connections, unlock, notifications, sign out", "more-settings") { ctx.push(Route.Settings) }
    }
}

@Composable
fun NotificationsScreen(ctx: ScreenContext) {
    val scope = rememberCoroutineScope()
    val loader = rememberLoader(ctx.connection.key) {
        ctx.api.get("/api/v1/notifications", NotificationPage.serializer(), mapOf("pageSize" to "50", "sort" to "-createdAt"))
    }
    var error by remember { mutableStateOf<String?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ScreenTitle("Notifications")
        error?.let { Notice(it, Tone.Danger) }
        LoadContent(loader, "Loading notifications…") { page ->
            // The inbox is open: what's here now doesn't need a local notification later.
            if (page.supportsCursor) {
                page.cursor?.let { ctx.graph.settings.setRefreshCursor(ctx.connection.key, crowtech.crowhr.notify.RefreshRunner.SERVER_PREFIX + it) }
            } else {
                page.items.maxByOrNull { it.createdAt }?.let { newest ->
                    val cursor = ctx.graph.settings.refreshCursor(ctx.connection.key)
                    if (cursor == null || newest.createdAt > cursor) ctx.graph.settings.setRefreshCursor(ctx.connection.key, newest.createdAt)
                }
            }
            if (page.unread > 0) {
                LinkButton("Mark all as read", {
                    scope.launch {
                        try { ctx.api.postEmpty("/api/v1/notifications/read-all"); loader.reload() } catch (e: Exception) { error = e.userMessage() }
                    }
                })
            }
            if (page.items.isEmpty()) EmptyState("No notifications", "Decisions on your requests and new tasks appear here.")
            page.items.forEach { n -> NotificationRow(n) {
                if (n.readAt == null) scope.launch {
                    runCatching { ctx.api.postEmpty("/api/v1/notifications/${n.id}/read") }
                    loader.reload()
                }
            } }
        }
    }
}

@Composable
private fun NotificationRow(n: AppNotification, onOpen: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onOpen).padding(vertical = 10.dp).testTag("notification-row")
            .semantics { if (n.readAt == null) contentDescription = "Unread: ${n.title}" },
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.padding(top = 6.dp).size(8.dp).background(if (n.readAt == null) Crow.colors.accent else Crow.colors.hairline, CircleShape))
        Column(Modifier.weight(1f)) {
            Text(n.title, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = if (n.readAt == null) FontWeight.Medium else FontWeight.Normal))
            n.body?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted) }
            Text(Formats.parseInstant(n.createdAt)?.let(Formats::dateTime) ?: "", style = Numeric.copy(fontSize = MaterialTheme.typography.labelSmall.fontSize), color = Crow.colors.muted)
        }
    }
    Hairline()
}

@Composable
fun ProfileScreen(ctx: ScreenContext) {
    val loader = rememberLoader(ctx.connection.key) { ctx.api.get("/api/v1/people/me/profile", Profile.serializer()) }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ScreenTitle("My profile", "To change your details, use Crow HR on the web.")
        when (val s = loader.value) {
            is LoadState.Failed -> {
                // Members without an employee record still have an account.
                ctx.me?.let { AccountCard(it) } ?: Notice(s.message, Tone.Danger)
            }
            else -> LoadContent(loader, "Loading your profile…") { p ->
                CrowCard {
                    Text(p.employee.preferredName ?: p.employee.name, style = MaterialTheme.typography.titleLarge)
                    p.employee.job?.jobTitle?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Crow.colors.muted) }
                    Column(Modifier.padding(top = 8.dp)) {
                        KeyValueRow("Employee number", p.employee.employeeNumber, numeric = true)
                        KeyValueRow("Legal name", p.employee.legalName)
                        p.employee.job?.department?.let { KeyValueRow("Department", it.name) }
                        p.employee.job?.location?.let { KeyValueRow("Location", it.name) }
                        p.employee.job?.manager?.let { KeyValueRow("Manager", it.name) }
                        p.employee.workEmail?.let { KeyValueRow("Work email", it) }
                        p.personal?.let { pe ->
                            if (pe.idNumberMasked.isNotBlank()) KeyValueRow(pe.idType.ifBlank { "ID" }.replace('_', ' ').uppercase(), pe.idNumberMasked, numeric = true)
                            pe.mobile?.let { KeyValueRow("Mobile", it, numeric = true) }
                        }
                        p.employee.status?.label?.let { KeyValueRow("Status", it) }
                    }
                }
                ctx.me?.let { AccountCard(it) }
            }
        }
    }
}

@Composable
private fun AccountCard(me: Me) {
    CrowCard {
        Label("Account")
        KeyValueRow("Signed in as", me.user.email)
        KeyValueRow("Organisation", me.organisation.name)
        if (me.roles.isNotEmpty()) KeyValueRow("Roles", me.roles.joinToString(", ") { it.replace('_', ' ') })
    }
}

@Composable
fun SettingsScreen(ctx: ScreenContext) {
    val context = LocalContext.current
    val graph = ctx.graph
    var notifications by remember { mutableStateOf(graph.settings.notificationsEnabled) }
    var lock by remember { mutableStateOf(graph.lock.enabled) }
    var confirmSignOut by remember { mutableStateOf(false) }
    val pending = remember { graph.punchQueue(ctx.connection).pending().size }
    val notifyPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        notifications = granted
        graph.settings.notificationsEnabled = granted
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ScreenTitle("Settings")

        SectionTitle("Connections")
        graph.connections.all().forEach { c ->
            CrowCard(border = if (c.key == ctx.connection.key) 2.dp else 1.dp) {
                Text(c.displayName, style = MaterialTheme.typography.titleSmall)
                Text(c.server + if (c.insecure) " · not encrypted" else "", style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted)
                if (c.key == ctx.connection.key) Label("In use", Modifier.padding(top = 4.dp), color = Crow.colors.ink)
                else SecondaryButton("Switch", { ctx.vm.switchTo(c) }, Modifier.fillMaxWidth().padding(top = 8.dp))
            }
        }
        if (graph.connections.all().size < crowtech.crowhr.connect.ConnectionStore.LIMIT) {
            LinkButton("Add a connection", ctx.vm::addConnection)
        } else {
            Text("You have 5 connections, the most this app keeps. Remove one to add another.", style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted)
        }

        val hidden = AppScreen.entries.filterNot { ctx.connection.isAvailable(it) }
        if (hidden.isNotEmpty()) {
            SectionTitle("Server version")
            hidden.forEach { Notice(it.unavailableNotice, Tone.Neutral) }
        }

        SectionTitle("Security")
        ToggleRow(
            "Unlock with fingerprint, face or screen lock",
            if (Biometric.available(context)) "Asked when you open the app and after 5 minutes away." else "Set a screen lock on this phone to use this.",
            checked = lock, enabled = Biometric.available(context), tag = "toggle-lock",
        ) { lock = it; graph.lock.enabled = it }

        SectionTitle("Notifications")
        ToggleRow(
            "Tell me about new items",
            "Checks about every 15 minutes. The message only says how many items are new, never what they are.",
            checked = notifications, tag = "toggle-notifications",
        ) { on ->
            if (on && android.os.Build.VERSION.SDK_INT >= 33 &&
                context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                notifyPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else {
                notifications = on
                graph.settings.notificationsEnabled = on
            }
        }

        SectionTitle("Privacy")
        Text(
            "This app talks only to ${ctx.connection.server}. It has no analytics, crash reporting or advertising, and Crow Tech receives nothing. Your data on this phone is encrypted and is deleted when you sign out.",
            style = MaterialTheme.typography.bodyMedium,
        )

        SectionTitle("Sign out")
        if (confirmSignOut) {
            Notice(
                if (pending > 0) "$pending clock-in${if (pending == 1) " hasn't" else "s haven't"} been sent yet. Signing out deletes ${if (pending == 1) "it" else "them"} from this phone."
                else "Signing out ends this phone's session and deletes your data from it.",
                Tone.Warning,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SecondaryButton("Sign out", { ctx.vm.signOut(ctx.connection) }, Modifier.weight(1f).testTag("confirm-sign-out"), tone = Tone.Danger)
                SecondaryButton("Stay signed in", { confirmSignOut = false }, Modifier.weight(1f))
            }
        } else {
            SecondaryButton("Sign out of ${ctx.connection.displayName}", { confirmSignOut = true }, Modifier.fillMaxWidth().testTag("sign-out"), tone = Tone.Danger)
        }

        SectionTitle("About")
        KeyValueRow("App version", BuildConfig.VERSION_NAME, numeric = true)
        LinkButton("Open-source licences", { ctx.push(Route.Licences) })
    }
}

@Composable
private fun ToggleRow(title: String, detail: String, checked: Boolean, enabled: Boolean = true, tag: String, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted)
        }
        Switch(
            checked = checked, onCheckedChange = onChange, enabled = enabled, modifier = Modifier.testTag(tag),
            colors = SwitchDefaults.colors(checkedTrackColor = Crow.colors.accent, checkedThumbColor = Crow.colors.onAccent, checkedBorderColor = Crow.colors.ink),
        )
    }
}

@Composable
fun LicencesScreen() {
    val context = LocalContext.current
    val files = remember { context.assets.list("licences")?.sorted() ?: emptyList() }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ScreenTitle("Open-source licences", "Crow HR is MIT-licensed. It bundles these fonts and libraries.")
        Text(
            "ThirdParty-Notices lists every library in the app with its version and licence. Tap an entry to read it.",
            style = MaterialTheme.typography.bodyMedium,
        )
        files.forEach { name ->
            var open by remember { mutableStateOf(false) }
            CrowCard(onClick = { open = !open }) {
                Text(name.removeSuffix(".txt"), style = MaterialTheme.typography.titleSmall)
                if (open) {
                    val text = remember(name) { context.assets.open("licences/$name").bufferedReader().readText() }
                    Text(text, style = Numeric.copy(fontSize = MaterialTheme.typography.bodySmall.fontSize), modifier = Modifier.padding(top = 8.dp))
                }
            }
        }
    }
}
