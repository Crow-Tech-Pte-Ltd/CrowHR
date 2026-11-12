package crowtech.crowhr.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import crowtech.crowhr.api.Me
import crowtech.crowhr.api.MySchedule
import crowtech.crowhr.api.RosterPerson
import crowtech.crowhr.api.RosterShift
import crowtech.crowhr.api.RosterView
import crowtech.crowhr.api.Shift
import crowtech.crowhr.api.SwapInput
import crowtech.crowhr.api.SwapRequest
import crowtech.crowhr.core.Formats
import crowtech.crowhr.ui.Route
import crowtech.crowhr.ui.ScreenContext
import crowtech.crowhr.ui.components.CrowCard
import crowtech.crowhr.ui.components.EmptyState
import crowtech.crowhr.ui.components.FieldError
import crowtech.crowhr.ui.components.Hairline
import crowtech.crowhr.ui.components.Label
import crowtech.crowhr.ui.components.LinkButton
import crowtech.crowhr.ui.components.LoadContent
import crowtech.crowhr.ui.components.Notice
import crowtech.crowhr.ui.components.PrimaryButton
import crowtech.crowhr.ui.components.ScreenTitle
import crowtech.crowhr.ui.components.SecondaryButton
import crowtech.crowhr.ui.components.SectionTitle
import crowtech.crowhr.ui.components.StatusChip
import crowtech.crowhr.ui.components.Tone
import crowtech.crowhr.ui.components.rememberLoader
import crowtech.crowhr.ui.components.userMessage
import crowtech.crowhr.ui.theme.Crow
import crowtech.crowhr.ui.theme.Numeric
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

/** "Mon 2 Nov 2026" */
fun dayHeading(iso: String): String {
    val d = LocalDate.parse(iso.take(10))
    return "${d.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.UK)} ${Formats.date(d)}"
}

/** Shift swaps, give-aways and open-shift pickups (web: My schedule), as rules the tests can read. */
object SwapLogic {
    const val NOTE_MAX = 200

    fun status(status: String): Pair<String, Tone> = when (status) {
        "pending_peer" -> "Waiting for colleague" to Tone.Warning
        "pending_approval" -> "Waiting for approval" to Tone.Warning
        "approved" -> "Approved" to Tone.Success
        "rejected" -> "Not approved" to Tone.Danger
        "declined" -> "Declined" to Tone.Neutral
        "cancelled" -> "Cancelled" to Tone.Neutral
        "expired" -> "Expired" to Tone.Neutral
        else -> status to Tone.Neutral
    }

    /** A colleague's offers waiting for my answer. */
    fun incoming(swaps: List<SwapRequest>) = swaps.filter { it.direction == "incoming" && it.status == "pending_peer" }

    /** What I asked for, newest first as the server sends them (the web shows ten). */
    fun outgoing(swaps: List<SwapRequest>) = swaps.filter { it.direction == "outgoing" }.take(10)

    fun cancellable(swap: SwapRequest) = swap.status == "pending_peer" || swap.status == "pending_approval"

    /** One of my shifts from today on, not already in a swap, on a server that names its roster. */
    fun canOffer(shift: Shift, today: String) = shift.kind == "shift" && shift.date >= today && !shift.pendingSwap && shift.rosterId.isNotBlank()

    /** I already asked for this open shift (and haven't cancelled). */
    fun askedFor(open: Shift, swaps: List<SwapRequest>) =
        swaps.any { it.direction == "outgoing" && it.kind == "pickup" && it.shift.id == open.id && cancellable(it) }

    private fun at(s: crowtech.crowhr.api.SwapShift) = listOf(dayHeading(s.date), s.time).filter { it.isNotBlank() }.joinToString(" ")

    /** "Marcus Lim asks to swap their Mon 16 Nov 2026 09:00–17:00 for your Tue 17 Nov 2026 10:00–18:00." */
    fun offerText(swap: SwapRequest): String =
        if (swap.kind == "swap" && swap.peerShift != null) "${swap.requester.name} asks to swap their ${at(swap.shift)} for your ${at(swap.peerShift)}."
        else "${swap.requester.name} offers you their shift on ${at(swap.shift)}."

    /** "Pick up Mon 16 Nov 2026", "Swap Mon 16 Nov 2026 with Marcus Lim", "Give away … to Marcus Lim". */
    fun requestTitle(swap: SwapRequest): String = when (swap.kind) {
        "pickup" -> "Pick up ${at(swap.shift)}"
        "swap" -> "Swap ${at(swap.shift)}" + (swap.peer?.let { " with ${it.name}" } ?: "")
        else -> "Give away ${at(swap.shift)}" + (swap.peer?.let { " to ${it.name}" } ?: "")
    }

    fun colleagues(roster: RosterView, myEmployeeId: String?) = roster.employees.filter { it.id != myEmployeeId }

    /** Their shifts I could take in a swap: from today on, not already in a swap. */
    fun peerShifts(roster: RosterView, peerId: String?, today: String): List<RosterShift> =
        roster.shifts.filter { it.employeeId == peerId && peerId != null && it.kind == "shift" && it.date >= today && !it.pendingSwap }

    fun shiftLabel(s: RosterShift) = "${dayHeading(s.date)} ${s.start ?: "--:--"}–${s.end ?: "--:--"}"

    /** What stops the offer from being sent; null when it can go. */
    fun problem(kind: String, peer: String?, peerShift: String?, note: String): String? = when {
        peer == null -> "Choose the colleague to offer it to."
        kind == "swap" && peerShift == null -> "Choose their shift you'd take, or give the shift away instead."
        note.trim().length > NOTE_MAX -> "Keep the note to $NOTE_MAX characters."
        else -> null
    }

    fun input(kind: String, shiftId: String, peer: String, peerShift: String?, note: String) =
        SwapInput(kind = kind, shiftId = shiftId, peerEmployeeId = peer, peerShiftId = if (kind == "swap") peerShift else null, note = note.trim().ifEmpty { null })
}

@Composable
fun ScheduleScreen(ctx: ScreenContext) {
    val key = ctx.connection.key
    val scope = rememberCoroutineScope()
    val loader = rememberLoader(key, cached = { ctx.graph.cache.get(key, "schedule", MySchedule.serializer()) }) {
        ctx.api.get("/api/v1/scheduling/me", MySchedule.serializer()).also { ctx.graph.cache.put(key, "schedule", MySchedule.serializer(), it) }
    }
    var busy by remember { mutableStateOf<String?>(null) }
    var done by rememberSaveable { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<Pair<String, String>?>(null) }
    val today = LocalDate.now(Formats.SINGAPORE).toString()

    fun act(id: String, success: String, call: suspend () -> Unit) {
        busy = id
        error = null
        done = null
        scope.launch {
            try {
                call()
                done = success
                loader.reload()
            } catch (e: Exception) {
                error = id to e.userMessage()
            }
            busy = null
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ScreenTitle("My schedule", "Published shifts for the next two weeks. Offer a shift to a colleague or pick up an open one.")
        done?.let { Notice(it, Tone.Success, Modifier.semantics { liveRegion = LiveRegionMode.Polite }.testTag("schedule-done")) }
        LoadContent(loader, "Loading your schedule…") { s ->
            val offline = loader.value.let { it is crowtech.crowhr.ui.components.LoadState.Ready && it.offlineSince != null }
            val offers = SwapLogic.incoming(s.swaps)
            if (offers.isNotEmpty()) {
                SectionTitle("Waiting for your answer")
                offers.forEach { swap ->
                    CrowCard(border = 2.dp, modifier = Modifier.testTag("swap-offer-${swap.id}")) {
                        Text(SwapLogic.offerText(swap), style = MaterialTheme.typography.bodyMedium)
                        swap.note?.takeIf { it.isNotBlank() }?.let { Text("“$it”", style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted, modifier = Modifier.padding(top = 4.dp)) }
                        Text("If you accept, your manager approves it next. Nothing changes until then.", style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted, modifier = Modifier.padding(top = 4.dp))
                        error?.takeIf { it.first == swap.id }?.let { Notice(it.second, Tone.Danger, Modifier.padding(top = 8.dp)) }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                            SecondaryButton("Accept", {
                                act(swap.id, "Accepted. Your manager will approve it.") { ctx.api.postEmpty("/api/v1/scheduling/swaps/${swap.id}/accept", SwapRequest.serializer()) }
                            }, Modifier.weight(1f).testTag("swap-accept"), enabled = busy == null && !offline)
                            SecondaryButton("Decline", {
                                act(swap.id, "Declined.") { ctx.api.postEmpty("/api/v1/scheduling/swaps/${swap.id}/decline", SwapRequest.serializer()) }
                            }, Modifier.weight(1f).testTag("swap-decline"), enabled = busy == null && !offline)
                        }
                    }
                }
            }
            Text("${Formats.date(s.from)} to ${Formats.date(s.to)}", style = Numeric, color = Crow.colors.muted)
            val unpublished = s.weeks.filterNot { it.published }
            if (unpublished.isNotEmpty()) {
                Notice("The roster for the week of ${unpublished.joinToString(", ") { Formats.date(it.weekStart) }} isn't published yet.", Tone.Neutral)
            }
            if (s.shifts.isEmpty()) {
                EmptyState("No shifts", "You have no published shifts in this period.")
            } else {
                s.shifts.groupBy { it.date }.toSortedMap().forEach { (date, shifts) ->
                    Label(dayHeading(date), Modifier.padding(top = 8.dp))
                    shifts.forEach { shift ->
                        ShiftRow(shift) {
                            if (SwapLogic.canOffer(shift, today) && !offline) {
                                LinkButton("Swap or give away…", { ctx.push(Route.OfferShift(shift.rosterId, shift.id)) }, Modifier.testTag("offer-${shift.id}"))
                            }
                        }
                    }
                    Hairline()
                }
            }
            SectionTitle("Open shifts")
            if (s.openShifts.isEmpty()) {
                Text("No open shifts in this period.", style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted)
            } else {
                Text("Shifts nobody is rostered for yet. Ask to pick one up; your manager approves it.", style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted)
            }
            // Open shifts aren't grouped under a day heading, so each says which day it is.
            s.openShifts.sortedWith(compareBy({ it.date }, { it.start })).forEach { open ->
                ShiftRow(open, showDate = true) {
                    error?.takeIf { it.first == open.id }?.let { Notice(it.second, Tone.Danger, Modifier.padding(top = 8.dp)) }
                    if (SwapLogic.askedFor(open, s.swaps)) {
                        StatusChip("You asked for it", Tone.Accent, Modifier.padding(top = 6.dp))
                    } else {
                        SecondaryButton(
                            if (busy == open.id) "Asking…" else "Pick up",
                            { act(open.id, "Asked. Your manager will approve it.") { ctx.api.post("/api/v1/scheduling/swaps", SwapInput(kind = "pickup", shiftId = open.id), SwapInput.serializer(), SwapRequest.serializer()) } },
                            Modifier.fillMaxWidth().padding(top = 8.dp).testTag("pickup-${open.id}"), enabled = busy == null && !offline,
                        )
                    }
                }
            }
            val mine = SwapLogic.outgoing(s.swaps)
            SectionTitle("My swap requests")
            if (mine.isEmpty()) Text("You haven't asked for any swaps.", style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted)
            mine.forEach { swap ->
                val (label, tone) = SwapLogic.status(swap.status)
                Column(Modifier.fillMaxWidth().padding(vertical = 8.dp).testTag("swap-request-${swap.id}")) {
                    Column(Modifier.semantics(mergeDescendants = true) {}) {
                        Text(SwapLogic.requestTitle(swap), style = MaterialTheme.typography.titleSmall)
                        StatusChip(label, tone, Modifier.padding(top = 4.dp))
                        swap.reason?.takeIf { it.isNotBlank() && swap.status != "approved" }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted, modifier = Modifier.padding(top = 4.dp)) }
                    }
                    error?.takeIf { it.first == swap.id }?.let { Notice(it.second, Tone.Danger, Modifier.padding(top = 8.dp)) }
                    if (SwapLogic.cancellable(swap)) {
                        LinkButton("Cancel request", {
                            act(swap.id, "Request cancelled.") { ctx.api.postEmpty("/api/v1/scheduling/swaps/${swap.id}/cancel", SwapRequest.serializer()) }
                        }, Modifier.testTag("swap-cancel-${swap.id}"))
                    }
                }
                Hairline()
            }
        }
    }
}

@Composable
private fun ShiftRow(shift: Shift, showDate: Boolean = false, actions: @Composable () -> Unit = {}) {
    CrowCard(modifier = Modifier.padding(vertical = 4.dp).testTag(if (showDate) "open-shift-${shift.id}" else "shift-${shift.date}")) {
        // The shift reads as one TalkBack item; its buttons stay separate.
        Column(Modifier.semantics(mergeDescendants = true) {}) {
            if (showDate) Label(dayHeading(shift.date), Modifier.padding(bottom = 4.dp))
            if (shift.kind == "rest") {
                Text("Rest day", style = MaterialTheme.typography.titleSmall)
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("${shift.start ?: "--:--"}–${shift.end ?: "--:--"}", Modifier.weight(1f), style = Numeric.copy(fontSize = MaterialTheme.typography.titleMedium.fontSize))
                    shift.templateCode?.let { StatusChip(it, Tone.Neutral) }
                }
                Text(
                    listOfNotNull(shift.scopeLabel.ifBlank { null }, if (shift.breakMinutes > 0) "${shift.breakMinutes} min break" else null, "${Formats.duration(shift.paidMinutes)} paid")
                        .joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted,
                )
            }
            shift.note?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            if (shift.pendingSwap) StatusChip("Swap requested", Tone.Accent, Modifier.padding(top = 4.dp))
        }
        actions()
    }
}

/** Offer one of my shifts to a colleague on the same roster: swap it for one of theirs, or give it away. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OfferShiftScreen(ctx: ScreenContext, rosterId: String, shiftId: String) {
    val scope = rememberCoroutineScope()
    val roster = rememberLoader(ctx.connection.key, rosterId) { ctx.api.get("/api/v1/scheduling/rosters/$rosterId", RosterView.serializer()) }
    val myEmployee = rememberLoader(ctx.connection.key, ctx.me?.employeeId) { ctx.me?.employeeId ?: ctx.api.get("/api/v1/me", Me.serializer()).employeeId }
    var kind by rememberSaveable { mutableStateOf("swap") }
    var peer by rememberSaveable { mutableStateOf<String?>(null) }
    var peerShift by rememberSaveable { mutableStateOf<String?>(null) }
    var note by rememberSaveable { mutableStateOf("") }
    var problem by rememberSaveable { mutableStateOf<String?>(null) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }
    var sent by rememberSaveable { mutableStateOf(false) }
    val today = LocalDate.now(Formats.SINGAPORE).toString()

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ScreenTitle("Swap or give away", "Your colleague accepts first, then your manager approves. Nothing changes until then.")
        if (sent) {
            Notice("Sent. You'll see the answer under My swap requests, and in Notifications.", Tone.Success, title = "Request sent")
            PrimaryButton("Done", ctx.pop, Modifier.fillMaxWidth().testTag("offer-done"))
            return@Column
        }
        LoadContent(roster, "Loading the roster…") { r ->
            val shift = r.shifts.firstOrNull { it.id == shiftId }
            if (shift == null) {
                Notice("This shift is no longer on the published roster. Go back and pull to refresh.", Tone.Warning)
                return@LoadContent
            }
            CrowCard {
                Label("Your shift")
                Text(SwapLogic.shiftLabel(shift), style = Numeric.copy(fontSize = MaterialTheme.typography.titleMedium.fontSize), modifier = Modifier.padding(top = 2.dp))
                if (r.roster.scopeLabel.isNotBlank()) Text(r.roster.scopeLabel, style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted)
            }
            Label("What would you like?", Modifier.padding(top = 4.dp))
            Column(Modifier.selectableGroup()) {
                listOf("swap" to "Swap for one of their shifts", "giveaway" to "Give it away").forEach { (value, label) ->
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 48.dp)
                            .selectable(selected = kind == value, role = Role.RadioButton) { kind = value; problem = null }
                            .testTag("offer-kind-$value"),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = kind == value, onClick = null, colors = RadioButtonDefaults.colors(selectedColor = Crow.colors.ink))
                        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(start = 12.dp))
                    }
                }
            }
            val me = (myEmployee.value as? crowtech.crowhr.ui.components.LoadState.Ready)?.value
            val colleagues = SwapLogic.colleagues(r, me)
            Picker(
                "Colleague", "Choose a colleague", colleagues.firstOrNull { it.id == peer }?.name, colleagues, { it.name }, "offer-colleague",
            ) { p: RosterPerson -> peer = p.id; peerShift = null; problem = null }
            if (colleagues.isEmpty()) Text("Nobody else is on this roster.", style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted)
            if (kind == "swap" && peer != null) {
                val theirs = SwapLogic.peerShifts(r, peer, today)
                if (theirs.isEmpty()) {
                    Text("They have no upcoming shifts on this roster. Give the shift away instead.", style = MaterialTheme.typography.bodyMedium, color = Crow.colors.muted)
                } else {
                    Picker(
                        "Their shift you'd take", "Choose a shift", theirs.firstOrNull { it.id == peerShift }?.let(SwapLogic::shiftLabel), theirs, SwapLogic::shiftLabel, "offer-their-shift",
                    ) { s: RosterShift -> peerShift = s.id; problem = null }
                }
            }
            OutlinedTextField(
                note, { note = it.take(SwapLogic.NOTE_MAX) }, label = { Text("Note (optional)") },
                supportingText = { Text("${note.length} of ${SwapLogic.NOTE_MAX} characters. Your colleague and manager see it.") },
                modifier = Modifier.fillMaxWidth().testTag("offer-note"), minLines = 2,
            )
            FieldError(problem)
            error?.let { Notice(it, Tone.Danger, Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
            PrimaryButton("Send request", {
                problem = SwapLogic.problem(kind, peer, peerShift, note)
                val who = peer
                if (problem != null || who == null) return@PrimaryButton
                sending = true
                error = null
                scope.launch {
                    try {
                        ctx.api.post("/api/v1/scheduling/swaps", SwapLogic.input(kind, shiftId, who, peerShift, note), SwapInput.serializer(), SwapRequest.serializer())
                        sent = true
                    } catch (e: Exception) {
                        error = e.userMessage()
                    }
                    sending = false
                }
            }, Modifier.fillMaxWidth().testTag("offer-send"), loading = sending, enabled = !sending)
            SecondaryButton("Cancel", ctx.pop, Modifier.fillMaxWidth())
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun <T> Picker(label: String, placeholder: String, value: String?, options: List<T>, text: (T) -> String, tag: String, onPick: (T) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
        OutlinedTextField(
            value = value ?: "", onValueChange = {}, readOnly = true,
            label = { Text(label) }, placeholder = { Text(placeholder) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable).testTag(tag),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { o -> DropdownMenuItem(text = { Text(text(o)) }, onClick = { onPick(o); expanded = false }) }
        }
    }
}
