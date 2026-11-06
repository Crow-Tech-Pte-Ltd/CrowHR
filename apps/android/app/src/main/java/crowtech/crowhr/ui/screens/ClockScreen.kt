package crowtech.crowhr.ui.screens

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.SystemClock
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.location.LocationManagerCompat
import crowtech.crowhr.api.AttendanceMe
import crowtech.crowhr.api.PunchView
import crowtech.crowhr.core.Formats
import crowtech.crowhr.punch.ApiPunchSender
import crowtech.crowhr.punch.EnqueueResult
import crowtech.crowhr.punch.PunchLabels
import crowtech.crowhr.punch.PunchLocation
import crowtech.crowhr.punch.PunchQueue
import crowtech.crowhr.punch.PunchSync
import crowtech.crowhr.punch.QueuedPunch
import crowtech.crowhr.punch.StopReason
import crowtech.crowhr.ui.ScreenContext
import crowtech.crowhr.ui.components.CrowCard
import crowtech.crowhr.ui.components.Hairline
import crowtech.crowhr.ui.components.Label
import crowtech.crowhr.ui.components.LinkButton
import crowtech.crowhr.ui.components.LoadState
import crowtech.crowhr.ui.components.LoadingState
import crowtech.crowhr.ui.components.Notice
import crowtech.crowhr.ui.components.PrimaryButton
import crowtech.crowhr.ui.components.ScreenTitle
import crowtech.crowhr.ui.components.SecondaryButton
import crowtech.crowhr.ui.components.SectionTitle
import crowtech.crowhr.ui.components.StatusChip
import crowtech.crowhr.ui.components.Tone
import crowtech.crowhr.ui.components.rememberLoader
import crowtech.crowhr.ui.theme.Crow
import crowtech.crowhr.ui.theme.Numeric
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.Executors
import kotlin.coroutines.resume

@Composable
fun ClockScreen(ctx: ScreenContext) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val queue = remember(ctx.connection.key) { ctx.graph.punchQueue(ctx.connection) }
    val monotonic = remember { crowtech.crowhr.punch.AndroidMonotonicClock(context.applicationContext) }
    var version by remember { mutableIntStateOf(0) }
    val status = rememberLoader(ctx.connection.key) { ctx.api.get("/api/v1/attendance/me", AttendanceMe.serializer()) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<String, Tone>?>(null) }
    var discard by remember { mutableStateOf<QueuedPunch?>(null) }
    // Punches sent by PunchSync in the background update this screen too.
    val changes by queue.changes.collectAsState()
    var hadPending by remember { mutableStateOf(queue.pending().isNotEmpty()) }
    LaunchedEffect(changes) {
        version++
        val pendingNow = queue.pending().isNotEmpty()
        if (hadPending && !pendingNow) {
            message = null
            status.reload()
        }
        hadPending = pendingNow
    }
    val punches = remember(version, changes) { queue.all() }
    val me = (status.value as? LoadState.Ready)?.value
    val serverClockedIn = me?.clockedIn ?: false
    val nextKind = remember(version, serverClockedIn) { queue.nextKind(serverClockedIn) }
    val wantsLocation = me?.location?.mode?.let { it != "off" } ?: false

    suspend fun drain() {
        val result = queue.drain(ctx.graph.clock(), ApiPunchSender(ctx.api), monotonic)
        version++
        when (result.stopReason) {
            StopReason.Network -> {
                PunchSync.request(context)
                message = "Saved on this phone. It will be sent automatically when you're back online." to Tone.Warning
            }
            StopReason.AuthRequired -> message = "Sign in again to send your saved clock-ins." to Tone.Warning
            null -> if (result.sent > 0) status.reload()
        }
    }

    fun punch(location: PunchLocation?) {
        val now = ctx.graph.clock()
        val r = queue.enqueue(
            kind = nextKind,
            deviceTime = now,
            monotonicMillis = monotonic.elapsedMillis(),
            bootCount = monotonic.bootCount,
            utcOffsetMinutes = ZoneId.systemDefault().rules.getOffset(now).totalSeconds / 60,
            location = location,
        )
        version++
        if (r is EnqueueResult.QueueFull) {
            message = PunchQueue.QUEUE_FULL_MESSAGE to Tone.Danger
            busy = false
            return
        }
        message = null
        scope.launch {
            drain()
            busy = false
        }
    }

    val locationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        scope.launch { punch(if (granted) currentLocation(context) else null) }
    }

    fun onTap() {
        busy = true
        if (!wantsLocation) return punch(null)
        if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            scope.launch { punch(currentLocation(context)) }
        } else {
            locationPermission.launch(Manifest.permission.ACCESS_FINE_LOCATION)
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ScreenTitle("Clock in", Formats.dateTime(ctx.graph.clock()).substringBefore(","))
        when (val s = status.value) {
            LoadState.Loading -> LoadingState("Checking your status…")
            is LoadState.Failed -> Notice(
                if (s.offline) "You're offline. You can still clock in: it's saved on this phone and sent when you're back online." else s.message,
                if (s.offline) Tone.Warning else Tone.Danger,
            )
            is LoadState.Ready -> StatusCard(s.value, queue.pending())
        }
        if (me?.employeeId == null && status.value is LoadState.Ready) {
            Notice("Your account isn't linked to an employee record yet, so clock-ins can't be recorded. Ask HR.", Tone.Warning)
        }
        me?.location?.let { policy ->
            if (policy.mode != "off") {
                Notice(
                    policy.pdpaNotice ?: "Your organisation records your location when you clock in or out, only at that moment.",
                    Tone.Neutral,
                    title = if (policy.mode == "required") "Location is required" else "Location is optional",
                )
            }
        }
        PrimaryButton(
            if (nextKind == "in") "Clock in" else "Clock out",
            ::onTap,
            Modifier.fillMaxWidth().testTag("clock-button"),
            loading = busy,
            enabled = !busy,
        )
        message?.let { (text, tone) -> Notice(text, tone, Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
        if (punches.isNotEmpty()) {
            SectionTitle("On this phone")
            Text(
                "Every tap is kept here until the server has answered. Nothing is deleted without asking you.",
                style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted,
            )
            punches.asReversed().forEach { p ->
                PunchRow(p, onDiscard = { discard = p }, onDismiss = { queue.dismiss(p.key) })
                Hairline()
            }
            if (queue.pending().isNotEmpty()) {
                SecondaryButton("Send now", { scope.launch { drain() } }, Modifier.fillMaxWidth().padding(top = 8.dp))
            }
        }
        discard?.let { p ->
            Notice("Discard this ${if (p.kind == "in") "clock-in" else "clock-out"} from ${Formats.dateTime(Instant.parse(p.deviceTime))}? It hasn't been sent and will be lost.", Tone.Warning)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SecondaryButton("Discard", { queue.discard(p.key); discard = null; version++ }, Modifier.weight(1f), tone = Tone.Danger)
                SecondaryButton("Keep", { discard = null }, Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun StatusCard(me: AttendanceMe, pending: List<QueuedPunch>) {
    val lastPending = pending.lastOrNull()
    CrowCard {
        Label("Status")
        val (text, since) = when {
            lastPending != null -> (if (lastPending.kind == "in") "Clocked in" else "Clocked out") to Instant.parse(lastPending.deviceTime)
            me.clockedIn -> "Clocked in" to me.lastPunch?.let { Formats.parseInstant(it.recordedAt) }
            else -> "Not clocked in" to null
        }
        Text(text, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(top = 4.dp).testTag("clock-status"))
        if (since != null) Text("Since ${Formats.time(since)}", style = Numeric.copy(fontSize = MaterialTheme.typography.bodyMedium.fontSize), color = Crow.colors.muted)
        if (lastPending != null) Text("Not sent yet", style = MaterialTheme.typography.bodySmall, color = Crow.colors.warning)
        if (me.today.isNotEmpty()) {
            Label("Today", Modifier.padding(top = 12.dp))
            me.today.forEach { ServerPunchRow(it) }
        }
    }
}

@Composable
private fun ServerPunchRow(p: PunchView) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(Formats.parseInstant(p.recordedAt)?.let(Formats::time) ?: "--:--", style = Numeric)
        Text(if (p.kind == "in") "In" else "Out", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        if (p.voided) StatusChip("Voided", Tone.Neutral) else if (p.status == "flagged") StatusChip("Flagged", Tone.Warning)
    }
}

@Composable
private fun PunchRow(p: QueuedPunch, onDiscard: () -> Unit, onDismiss: () -> Unit) {
    val labels = PunchLabels.of(p)
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(Formats.dateTime(Instant.parse(p.deviceTime)), style = Numeric.copy(fontSize = MaterialTheme.typography.bodyMedium.fontSize))
            Text(if (p.kind == "in") "Clock in" else "Clock out", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            StatusChip(
                when (p.state) { PunchQueue.PENDING -> "Waiting"; PunchQueue.SYNCED -> "Synced"; PunchQueue.FLAGGED -> "Flagged"; else -> "Not accepted" },
                when (p.state) { PunchQueue.PENDING -> Tone.Accent; PunchQueue.SYNCED -> Tone.Success; PunchQueue.FLAGGED -> Tone.Warning; else -> Tone.Danger },
            )
        }
        labels.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted) }
        if (p.isPending) LinkButton("Discard…", onDiscard)
        // A refused punch stays with the server's reason until the employee has read it.
        if (p.state == PunchQueue.REJECTED) LinkButton("Dismiss", onDismiss)
    }
}

/** One location fix from the platform (no Play Services), at most 10 s; null if unavailable. */
@SuppressLint("MissingPermission")
private suspend fun currentLocation(context: Context): PunchLocation? {
    if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
        context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED
    ) return null
    val manager = context.getSystemService(LocationManager::class.java) ?: return null
    val provider = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).firstOrNull { manager.isProviderEnabled(it) } ?: return null
    return withTimeoutOrNull(10_000) {
        suspendCancellableCoroutine { cont ->
            val signal = androidx.core.os.CancellationSignal()
            cont.invokeOnCancellation { signal.cancel() }
            LocationManagerCompat.getCurrentLocation(manager, provider, signal, Executors.newSingleThreadExecutor()) { loc ->
                cont.resume(loc?.let { PunchLocation(it.latitude, it.longitude, if (it.hasAccuracy()) it.accuracy.toDouble() else null) })
            }
        }
    }
}
