package crowtech.crowhr.ui.screens

import android.net.Uri
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import crowtech.crowhr.api.Me
import crowtech.crowhr.ui.AttachmentException
import crowtech.crowhr.ui.Attachments
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import crowtech.crowhr.api.ApiException
import crowtech.crowhr.api.CancelLeave
import crowtech.crowhr.api.Items
import crowtech.crowhr.api.LeaveApplication
import crowtech.crowhr.api.LeaveAttachment
import crowtech.crowhr.api.LeaveBalance
import crowtech.crowhr.api.LeaveQuote
import crowtech.crowhr.api.LeaveQuoteRequest
import crowtech.crowhr.api.LeaveRequest
import crowtech.crowhr.api.LeaveType
import crowtech.crowhr.core.Formats
import crowtech.crowhr.ui.Route
import crowtech.crowhr.ui.ScreenContext
import crowtech.crowhr.ui.ScreenMemory
import crowtech.crowhr.ui.components.CrowCard
import crowtech.crowhr.ui.components.EmptyState
import crowtech.crowhr.ui.components.FieldError
import crowtech.crowhr.ui.components.Hairline
import crowtech.crowhr.ui.components.Label
import crowtech.crowhr.ui.components.LinkButton
import crowtech.crowhr.ui.components.LocalDateSaver
import crowtech.crowhr.ui.components.jsonSaver
import kotlinx.serialization.builtins.nullable
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

private val BALANCES = Items.serializer(LeaveBalance.serializer())
private val REQUESTS = Items.serializer(LeaveRequest.serializer())
private val TYPES = Items.serializer(LeaveType.serializer())

/** One place for the leave status wording shared by history rows. */
private fun leaveStatus(status: String): Pair<String, Tone> = when (status) {
    "pending" -> "Waiting for approval" to Tone.Accent
    "approved" -> "Approved" to Tone.Success
    "rejected" -> "Rejected" to Tone.Danger
    "withdrawn" -> "Withdrawn" to Tone.Neutral
    "cancellation_pending" -> "Cancellation waiting" to Tone.Warning
    "cancelled" -> "Cancelled" to Tone.Neutral
    else -> status to Tone.Neutral
}

private fun quantity(q: Double, unit: String): String {
    val n = if (q % 1.0 == 0.0) q.toLong().toString() else q.toString()
    return "$n ${if (unit == "hours") (if (q == 1.0) "hour" else "hours") else (if (q == 1.0) "day" else "days")}"
}

@Composable
fun LeaveScreen(ctx: ScreenContext) {
    val key = ctx.connection.key
    val scope = rememberCoroutineScope()
    val balances = rememberLoader(
        key, memoryKey = ScreenMemory.key(key, "leave-balances"), cached = { ctx.graph.cache.get(key, "leave-balances", BALANCES) },
    ) {
        ctx.api.get("/api/v1/leave/balances", BALANCES).also { ctx.graph.cache.put(key, "leave-balances", BALANCES, it) }
    }
    val history = rememberLoader(key, memoryKey = ScreenMemory.key(key, "leave-history")) {
        // Without an employee ID the server lists every request the user may see (a manager's
        // team, everyone's for HR), so "My requests" waits for the user's own ID, and an account
        // without an employee record has no requests of its own. Before `/me` has answered, it
        // waits for the request the app already made (keyed on the connection only, so `/me`
        // arriving doesn't load the list a second time).
        val employeeId = (ctx.me ?: ctx.vm.me(ctx.connection) ?: ctx.api.get("/api/v1/me", Me.serializer())).employeeId
        if (employeeId == null) Items(emptyList())
        else ctx.api.get("/api/v1/leave/requests", REQUESTS, mapOf("employeeId" to employeeId, "limit" to "50"))
    }
    var actionError by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf<LeaveRequest?>(null) }
    var acting by remember { mutableStateOf(false) }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ScreenTitle("Leave", "Your balances for ${LocalDate.now(Formats.SINGAPORE).year}.")
        PrimaryButton("Apply for leave", { ctx.push(Route.LeaveApply) }, Modifier.fillMaxWidth().testTag("apply-leave"))
        SectionTitle("Balances")
        LoadContent(balances, "Loading balances…") { list ->
            val shown = list.items.filter { it.eligible || it.eligibleFrom != null }
            if (shown.isEmpty()) EmptyState("No leave balances", "Your organisation hasn't set up leave for you yet. Ask HR.")
            shown.forEach { b ->
                CrowCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(b.name, style = MaterialTheme.typography.titleSmall)
                            val detail = when {
                                !b.eligible && b.eligibleFrom != null -> "Available from ${Formats.date(b.eligibleFrom)}"
                                !b.tracked -> "Not counted"
                                else -> "of ${quantity(b.entitlement + b.carriedForward, b.unit)} · ${quantity(b.taken, b.unit)} taken" +
                                    if (b.pending > 0) " · ${quantity(b.pending, b.unit)} waiting" else ""
                            }
                            Text(detail, style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted)
                        }
                        if (b.eligible && b.tracked && b.available != null) {
                            Text(
                                quantity(b.available, b.unit),
                                style = Numeric.copy(fontSize = MaterialTheme.typography.titleMedium.fontSize, fontWeight = FontWeight.SemiBold),
                            )
                        }
                    }
                }
            }
        }
        SectionTitle("My requests")
        LoadContent(history, "Loading requests…") { list ->
            if (list.items.isEmpty()) EmptyState("No leave requests yet", "Requests you send appear here with their status.")
            list.items.forEach { r ->
                val (label, tone) = leaveStatus(r.status)
                Column(Modifier.fillMaxWidth().padding(vertical = 8.dp).testTag("leave-request")) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(r.type.name, style = MaterialTheme.typography.titleSmall)
                            Text(
                                if (r.startDate == r.endDate) Formats.date(r.startDate) else "${Formats.date(r.startDate)} to ${Formats.date(r.endDate)}",
                                style = Numeric.copy(fontSize = MaterialTheme.typography.bodySmall.fontSize), color = Crow.colors.muted,
                            )
                        }
                        Text(quantity(r.quantity, r.unit), style = Numeric)
                    }
                    StatusChip(label, tone, Modifier.padding(top = 4.dp))
                    if (r.status == "pending" || (r.status == "approved" && r.endDate >= LocalDate.now(Formats.SINGAPORE).toString())) {
                        LinkButton(if (r.status == "pending") "Withdraw…" else "Ask to cancel…", { confirm = r; actionError = null })
                    }
                    if (confirm?.id == r.id) {
                        Notice(
                            if (r.status == "pending") "Withdraw this request? Your approver won't see it any more." else "Ask to cancel this approved leave? It goes to your approver.",
                            Tone.Warning,
                        )
                        // Next to the buttons that caused it, not above a long list.
                        actionError?.let { Notice(it, Tone.Danger, Modifier.padding(top = 8.dp).semantics { liveRegion = LiveRegionMode.Polite }) }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                            SecondaryButton(if (r.status == "pending") "Withdraw" else "Ask to cancel", {
                                acting = true
                                scope.launch {
                                    actionError = null
                                    try {
                                        if (r.status == "pending") ctx.api.postEmpty("/api/v1/leave/requests/${r.id}/withdraw", LeaveRequest.serializer())
                                        else ctx.api.post("/api/v1/leave/requests/${r.id}/cancel", CancelLeave(), CancelLeave.serializer(), LeaveRequest.serializer())
                                        confirm = null
                                        history.reload()
                                        balances.reload()
                                    } catch (e: Exception) {
                                        actionError = e.userMessage()
                                    }
                                    acting = false
                                }
                            }, Modifier.weight(1f), tone = Tone.Danger, enabled = !acting)
                            SecondaryButton("Keep", { confirm = null }, Modifier.weight(1f), enabled = !acting)
                        }
                    }
                }
                Hairline()
            }
        }
    }
}

/** The next Monday–Friday after today in Singapore: a sensible first date to apply for. */
fun nextWorkingDay(today: LocalDate, holidays: Set<String> = emptySet()): LocalDate {
    // Only a sensible default for the form; the server's quote decides what counts. A public
    // holiday on a Sunday makes the Monday a holiday (Holidays Act 1998 s 4(3)).
    val off = holidays + holidays.mapNotNull { runCatching { LocalDate.parse(it) }.getOrNull() }
        .filter { it.dayOfWeek == DayOfWeek.SUNDAY }.map { it.plusDays(1).toString() }
    var d = today.plusDays(1)
    while (d.dayOfWeek == DayOfWeek.SATURDAY || d.dayOfWeek == DayOfWeek.SUNDAY || d.toString() in off) d = d.plusDays(1)
    return d
}

@kotlinx.serialization.Serializable
data class Holiday(val date: String, val name: String = "")

/**
 * The (start, end) sessions sent with a request. The Day choice is shown only for a one-day
 * request of a type with half days, so only then does the chosen session count.
 */
fun leaveSessions(start: LocalDate, end: LocalDate, type: LeaveType?, chosen: String): Pair<String, String> =
    if (start == end && type?.halfDays == true && chosen in setOf("full", "am", "pm")) chosen to chosen else "full" to "full"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LeaveApplyScreen(ctx: ScreenContext) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val types = rememberLoader(ctx.connection.key) { ctx.api.get("/api/v1/leave/types", TYPES) }
    // Saved state: the form survives rotation and the app being closed while a photo is taken.
    var type by rememberSaveable(stateSaver = jsonSaver(LeaveType.serializer().nullable)) { mutableStateOf(null) }
    val first = remember { nextWorkingDay(LocalDate.now(Formats.SINGAPORE)) }
    var start by rememberSaveable(stateSaver = LocalDateSaver) { mutableStateOf(first) }
    var end by rememberSaveable(stateSaver = LocalDateSaver) { mutableStateOf(first) }
    // Skip public holidays for the default date (the user hasn't picked one yet).
    LaunchedEffect(Unit) {
        val today = LocalDate.now(Formats.SINGAPORE)
        val holidays = runCatching {
            listOf(today.year, today.year + 1).flatMap { y ->
                ctx.api.get("/api/v1/leave/holidays", Items.serializer(Holiday.serializer()), mapOf("year" to y.toString())).items
            }.map { it.date }.toSet()
        }.getOrDefault(emptySet())
        val better = nextWorkingDay(today, holidays)
        if (start == first && end == first) { start = better; end = better }
    }
    var startSession by rememberSaveable { mutableStateOf("full") }
    var reason by rememberSaveable { mutableStateOf("") }
    // Not saved: a document can be megabytes, more than the saved state may hold.
    var attachment by remember { mutableStateOf<LeaveAttachment?>(null) }
    var quote by remember { mutableStateOf<LeaveQuote?>(null) }
    var quoteError by remember { mutableStateOf<String?>(null) }
    var submitError by rememberSaveable { mutableStateOf<String?>(null) }
    var fieldError by rememberSaveable { mutableStateOf<String?>(null) }
    var submitting by remember { mutableStateOf(false) }
    var sent by rememberSaveable { mutableStateOf(false) }

    var attaching by remember { mutableStateOf(false) }
    // Photos are shrunk and documents read off the main thread (a 12 MP photo takes a while).
    fun attach(read: suspend () -> LeaveAttachment) {
        attaching = true
        fieldError = null
        scope.launch {
            try {
                attachment = withContext(Dispatchers.IO) { read() }
            } catch (e: AttachmentException) {
                fieldError = e.message
            } catch (e: Exception) {
                fieldError = "Couldn't read that file. Try another one."
            }
            attaching = false
        }
    }
    val capture = ctx.graph.receiptCamera.rememberCapture(onError = { fieldError = it }) { file ->
        if (file != null) attach { Attachments.photo(file, "photo-$start.jpg").also { file.delete() } }
    }
    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) attach { Attachments.fromDocument(context, uri) }
    }
    // A half day only for a one-day request of a type that has them: a session chosen earlier
    // and hidden since (longer dates, another type) is never sent.
    val (sendStart, sendEnd) = leaveSessions(start, end, type, startSession)

    LaunchedEffect(type, start, end, sendStart) {
        val t = type ?: return@LaunchedEffect
        delay(250)
        quote = null
        quoteError = null
        try {
            quote = ctx.api.post(
                "/api/v1/leave/quote",
                LeaveQuoteRequest(t.id, start.toString(), end.toString(), sendStart, sendEnd),
                LeaveQuoteRequest.serializer(), LeaveQuote.serializer(),
            )
        } catch (e: kotlinx.coroutines.CancellationException) {
            // The dates or type changed again: not an error ("Something went wrong" flashed
            // until the next quote's delay had passed). As on iOS.
            throw e
        } catch (e: Exception) {
            quoteError = e.userMessage()
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ScreenTitle("Apply for leave")
        if (sent) {
            Notice("Your request was sent to your approver. You'll see the decision under My requests.", Tone.Success, title = "Request sent")
            PrimaryButton("Done", ctx.pop, Modifier.fillMaxWidth().testTag("leave-done"))
            return@Column
        }
        LoadContent(types, "Loading leave types…") { list ->
            // NOT IMPLEMENTED (app): leave for a child (childcare and the like) needs the child
            // chosen, which only the web does. Same as iOS.
            val options = list.items.filter { !it.archived && !it.needsChild }
            if (list.items.any { !it.archived && it.needsChild }) {
                Text(
                    "Leave for a child, such as childcare leave, is applied for in Crow HR on the web.",
                    style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted,
                )
            }
            var expanded by remember { mutableStateOf(false) }
            ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
                OutlinedTextField(
                    value = type?.name ?: "",
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Leave type") },
                    placeholder = { Text("Choose a leave type") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
                    modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable).testTag("leave-type"),
                )
                ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                    options.forEach { o ->
                        DropdownMenuItem(text = { Text(o.name) }, onClick = { type = o; expanded = false; fieldError = null })
                    }
                }
            }
        }
        DateField("First day", start, Modifier.testTag("leave-start")) { start = it; if (end < it) end = it }
        DateField("Last day", end, Modifier.testTag("leave-end")) { end = if (it < start) start else it }
        if (type?.halfDays == true && start == end) {
            Label("Day")
            // Wraps at large text sizes instead of pushing "Afternoon" off the screen.
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("full" to "Full day", "am" to "Morning", "pm" to "Afternoon").forEach { (value, label) ->
                    FilterChip(selected = startSession == value, onClick = { startSession = value }, label = { Text(label) })
                }
            }
        }
        OutlinedTextField(reason, { reason = it }, label = { Text("Reason (optional)") }, modifier = Modifier.fillMaxWidth().testTag("leave-reason"), minLines = 2)
        type?.takeIf { it.attachment != "none" }?.let { t ->
            Label(if (t.attachment == "required") "Attachment (required)" else "Attachment (optional)")
            t.attachmentLabel?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted) }
            if (attaching) Text("Preparing the attachment…", style = MaterialTheme.typography.bodyMedium, color = Crow.colors.muted)
            attachment?.let { Text("Attached: ${it.filename}", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.testTag("leave-attached")) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SecondaryButton("Take photo", capture, Modifier.weight(1f), enabled = !attaching)
                SecondaryButton("Choose file", { pickFile.launch(Attachments.TYPES) }, Modifier.weight(1f), enabled = !attaching)
            }
        }
        quote?.let { q ->
            CrowCard(modifier = Modifier.testTag("leave-quote")) {
                Label("This request")
                Text(quantity(q.quantity, q.unit), style = Numeric.copy(fontSize = MaterialTheme.typography.titleLarge.fontSize, fontWeight = FontWeight.SemiBold))
                q.years.forEach { y ->
                    if (y.tracked && y.after != null) Text("${quantity(y.after, q.unit)} left in ${y.year} after this", style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted)
                }
            }
            q.issues.forEach { Notice(it.message, Tone.Danger) }
            q.warnings.forEach { Notice(it, Tone.Warning) }
        }
        quoteError?.let { Notice(it, Tone.Danger) }
        FieldError(fieldError)
        submitError?.let { Notice(it, Tone.Danger) }
        PrimaryButton("Send request", {
            val t = type
            when {
                t == null -> fieldError = "Choose a leave type."
                t.attachment == "required" && attachment == null -> fieldError = "Attach ${t.attachmentLabel ?: "a document"} (take a photo or choose a file)."
                quote?.ok == false -> fieldError = "Fix the problems above before sending."
                else -> {
                    fieldError = null
                    submitting = true
                    scope.launch {
                        try {
                            ctx.api.post(
                                "/api/v1/leave/requests",
                                LeaveApplication(t.id, start.toString(), end.toString(), sendStart, sendEnd, reason.trim().ifEmpty { null }, attachment?.let { listOf(it) }),
                                LeaveApplication.serializer(), LeaveRequest.serializer(),
                            )
                            sent = true
                        } catch (e: ApiException) {
                            submitError = e.message
                        } catch (e: Exception) {
                            submitError = e.userMessage()
                        }
                        submitting = false
                    }
                }
            }
        }, Modifier.fillMaxWidth().testTag("send-leave"), loading = submitting, enabled = !submitting && !attaching)
        SecondaryButton("Cancel", ctx.pop, Modifier.fillMaxWidth())
    }
}

/** A read-only date field ("31 Oct 2026") that opens the Material date picker. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateField(label: String, value: LocalDate, modifier: Modifier = Modifier, allowPast: Boolean = true, onChange: (LocalDate) -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    CrowCard(onClick = { open = true }, modifier = modifier) {
        Label(label)
        Text(Formats.date(value), style = Numeric.copy(fontSize = MaterialTheme.typography.titleMedium.fontSize), modifier = Modifier.padding(top = 2.dp))
        Text("Tap to change", style = MaterialTheme.typography.bodySmall, color = Crow.colors.link)
    }
    if (open) {
        val millis = value.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli()
        val state = rememberDatePickerState(
            initialSelectedDateMillis = millis,
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long) = allowPast || utcTimeMillis >= LocalDate.now(Formats.SINGAPORE).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli()
            },
        )
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton({
                    state.selectedDateMillis?.let { onChange(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate()) }
                    open = false
                }) { Text("OK") }
            },
            dismissButton = { TextButton({ open = false }) { Text("Cancel") } },
        ) { DatePicker(state) }
    }
}
