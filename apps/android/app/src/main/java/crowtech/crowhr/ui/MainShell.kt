package crowtech.crowhr.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import crowtech.crowhr.AppGraph
import crowtech.crowhr.api.ApiClient
import crowtech.crowhr.api.Me
import crowtech.crowhr.connect.AppScreen
import crowtech.crowhr.connect.SavedConnection
import crowtech.crowhr.ui.components.CrowIcons
import crowtech.crowhr.ui.components.Hairline
import crowtech.crowhr.ui.components.Label
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import crowtech.crowhr.ui.screens.ApprovalsScreen
import crowtech.crowhr.ui.screens.ClaimsScreen
import crowtech.crowhr.ui.screens.ClockScreen
import crowtech.crowhr.ui.screens.LeaveApplyScreen
import crowtech.crowhr.ui.screens.LeaveScreen
import crowtech.crowhr.ui.screens.LicencesScreen
import crowtech.crowhr.ui.screens.MoreScreen
import crowtech.crowhr.ui.screens.NewClaimScreen
import crowtech.crowhr.ui.screens.NotificationsScreen
import crowtech.crowhr.ui.screens.PayslipDetailScreen
import crowtech.crowhr.ui.screens.PayslipsScreen
import crowtech.crowhr.ui.screens.ProfileScreen
import crowtech.crowhr.ui.screens.ScheduleScreen
import crowtech.crowhr.ui.screens.SettingsScreen
import crowtech.crowhr.ui.theme.Crow

enum class Tab(val label: String, val icon: ImageVector, val screen: AppScreen?) {
    Clock("Clock", CrowIcons.Clock, AppScreen.Clock),
    Leave("Leave", CrowIcons.Calendar, AppScreen.Leave),
    Pay("Pay", CrowIcons.Payslip, AppScreen.Payslips),
    Tasks("Tasks", CrowIcons.Tasks, AppScreen.Approvals),
    More("More", CrowIcons.More, null),
}

/** What every screen gets: the connection's API client, the graph and navigation. */
class ScreenContext(
    val graph: AppGraph,
    val connection: SavedConnection,
    val api: ApiClient,
    val me: Me?,
    val push: (Route) -> Unit,
    val pop: () -> Unit,
    val vm: AppViewModel,
)

@Composable
fun MainShell(graph: AppGraph, vm: AppViewModel, screen: RootScreen.Main) {
    val connection = screen.connection
    val tabs = Tab.entries.filter { it.screen == null || connection.isAvailable(it.screen) }
    var savedTab by rememberSaveable(connection.key) { mutableStateOf(tabs.first().name) }
    // A tab the server no longer offers (meta changed) falls back to the first one.
    val tab = savedTab.takeIf { name -> tabs.any { it.name == name } } ?: tabs.first().name
    // The back stack and every screen's own state (form fields, scroll) are saved, so rotation,
    // a resize, process death while the camera or browser is open, and the lock screen keep
    // the user where they were.
    var stackCodes by rememberSaveable(connection.key) { mutableStateOf(emptyList<String>()) }
    val stack = Route.decodeStack(stackCodes)
    val screens = rememberSaveableStateHolder()
    fun forget(routes: List<Route>) = routes.forEach { screens.removeState(it.code) }
    fun push(route: Route) { stackCodes = stackCodes + route.code }
    fun pop() {
        val top = stack.lastOrNull() ?: return
        forget(listOf(top))
        stackCodes = stackCodes.dropLast(1)
    }
    fun select(t: String) {
        forget(stack)
        stackCodes = emptyList()
        savedTab = t
    }
    val api = remember(connection) { graph.api(connection) }
    val ctx = ScreenContext(graph, connection, api, screen.me, push = ::push, pop = ::pop, vm = vm)

    val open by vm.openRequest.collectAsState()
    LaunchedEffect(open) {
        when (open) {
            "approvals" -> select(Tab.Tasks.name)
            "notifications" -> { select(Tab.More.name); push(Route.Notifications) }
        }
        if (open != null) vm.openRequest.value = null
    }

    BackHandler(enabled = stack.isNotEmpty() || tab != tabs.first().name) {
        if (stack.isNotEmpty()) pop() else select(tabs.first().name)
    }

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        // Header: organisation (mono label) and Back on pushed screens.
        Row(
            Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))
                .heightIn(min = 52.dp).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (stack.isNotEmpty()) {
                Box(
                    Modifier.size(48.dp)
                        .clickable(role = Role.Button) { pop() }
                        .semantics { contentDescription = "Back" }
                        .testTag("back"),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(CrowIcons.Back, contentDescription = null, tint = Crow.colors.ink, modifier = Modifier.size(22.dp))
                }
            } else {
                Box(Modifier.padding(start = 8.dp))
            }
            Label(connection.displayName, Modifier.weight(1f).padding(horizontal = 4.dp), color = Crow.colors.ink)
        }
        Hairline()
        Box(Modifier.weight(1f).fillMaxWidth().imePadding(), contentAlignment = Alignment.TopCenter) {
            val route = stack.lastOrNull()
            screens.SaveableStateProvider(route?.code ?: "tab:$tab") {
                Column(
                    Modifier.widthIn(max = 640.dp).fillMaxWidth().verticalScroll(rememberScrollState())
                        .padding(horizontal = 16.dp, vertical = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(0.dp),
                ) {
                    when (route) {
                        null -> when (Tab.valueOf(tab)) {
                            Tab.Clock -> ClockScreen(ctx)
                            Tab.Leave -> LeaveScreen(ctx)
                            Tab.Pay -> PayslipsScreen(ctx)
                            Tab.Tasks -> ApprovalsScreen(ctx)
                            Tab.More -> MoreScreen(ctx)
                        }
                        is Route.PayslipDetail -> PayslipDetailScreen(ctx, route.id)
                        Route.LeaveApply -> LeaveApplyScreen(ctx)
                        Route.Claims -> ClaimsScreen(ctx)
                        Route.NewClaim -> NewClaimScreen(ctx)
                        Route.Schedule -> ScheduleScreen(ctx)
                        Route.Notifications -> NotificationsScreen(ctx)
                        Route.Profile -> ProfileScreen(ctx)
                        Route.Settings -> SettingsScreen(ctx)
                        Route.Licences -> LicencesScreen()
                    }
                }
            }
        }
        // Employees get a bottom tab bar (AGENTS.md design language).
        NavigationBar(containerColor = MaterialTheme.colorScheme.surface, tonalElevation = 0.dp) {
            tabs.forEach { t ->
                NavigationBarItem(
                    selected = tab == t.name,
                    onClick = { select(t.name) },
                    icon = { Icon(t.icon, contentDescription = null, modifier = Modifier.size(22.dp)) },
                    label = { Text(t.label, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Visible, softWrap = false) },
                    modifier = Modifier.testTag("tab-${t.name.lowercase()}"),
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = Crow.colors.onAccent,
                        selectedTextColor = Crow.colors.ink,
                        indicatorColor = Crow.colors.accent,
                        unselectedIconColor = Crow.colors.muted,
                        unselectedTextColor = Crow.colors.muted,
                    ),
                )
            }
        }
    }
}
