package crowtech.crowhr.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import crowtech.crowhr.api.MySchedule
import crowtech.crowhr.api.Shift
import crowtech.crowhr.core.Formats
import crowtech.crowhr.ui.ScreenContext
import crowtech.crowhr.ui.components.CrowCard
import crowtech.crowhr.ui.components.EmptyState
import crowtech.crowhr.ui.components.Hairline
import crowtech.crowhr.ui.components.Label
import crowtech.crowhr.ui.components.LoadContent
import crowtech.crowhr.ui.components.Notice
import crowtech.crowhr.ui.components.ScreenTitle
import crowtech.crowhr.ui.components.SectionTitle
import crowtech.crowhr.ui.components.StatusChip
import crowtech.crowhr.ui.components.Tone
import crowtech.crowhr.ui.components.rememberLoader
import crowtech.crowhr.ui.theme.Crow
import crowtech.crowhr.ui.theme.Numeric
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

/** "Mon 2 Nov 2026" */
fun dayHeading(iso: String): String {
    val d = LocalDate.parse(iso.take(10))
    return "${d.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.UK)} ${Formats.date(d)}"
}

@Composable
fun ScheduleScreen(ctx: ScreenContext) {
    val key = ctx.connection.key
    val loader = rememberLoader(key, cached = { ctx.graph.cache.get(key, "schedule", MySchedule.serializer()) }) {
        ctx.api.get("/api/v1/scheduling/me", MySchedule.serializer()).also { ctx.graph.cache.put(key, "schedule", MySchedule.serializer(), it) }
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ScreenTitle("My schedule", "Published shifts for the next two weeks.")
        LoadContent(loader, "Loading your schedule…") { s ->
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
                    shifts.forEach { ShiftRow(it) }
                    Hairline()
                }
            }
            if (s.openShifts.isNotEmpty()) {
                SectionTitle("Open shifts")
                Text("Shifts nobody is rostered for yet. Ask your manager or pick one up on the web.", style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted)
                // Open shifts aren't grouped under a day heading, so each says which day it is.
                s.openShifts.sortedWith(compareBy({ it.date }, { it.start })).forEach { ShiftRow(it, showDate = true) }
            }
        }
    }
}

@Composable
private fun ShiftRow(shift: Shift, showDate: Boolean = false) {
    CrowCard(modifier = Modifier.padding(vertical = 4.dp).semantics(mergeDescendants = true) {}.testTag(if (showDate) "open-shift-${shift.id}" else "shift-${shift.date}")) {
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
}
