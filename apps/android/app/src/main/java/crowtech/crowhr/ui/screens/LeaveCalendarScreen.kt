package crowtech.crowhr.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import crowtech.crowhr.api.CalendarEntry
import crowtech.crowhr.api.LeaveCalendar
import crowtech.crowhr.api.Me
import crowtech.crowhr.core.Formats
import crowtech.crowhr.ui.ScreenContext
import crowtech.crowhr.ui.components.CrowCard
import crowtech.crowhr.ui.components.EmptyState
import crowtech.crowhr.ui.components.Hairline
import crowtech.crowhr.ui.components.Label
import crowtech.crowhr.ui.components.LoadContent
import crowtech.crowhr.ui.components.ScreenTitle
import crowtech.crowhr.ui.components.SecondaryButton
import crowtech.crowhr.ui.components.StatusChip
import crowtech.crowhr.ui.components.Tone
import crowtech.crowhr.ui.components.rememberLoader
import crowtech.crowhr.ui.theme.Crow
import crowtech.crowhr.ui.theme.Numeric
import java.time.DayOfWeek
import java.time.LocalDate

/** The leave calendar (web: Leave → Calendar), as the web shows it on a phone: a list by day. */
object LeaveCalendarLogic {
    /** Two weeks at a time, as on the web. */
    const val SPAN_DAYS = 14L

    data class Row(val name: String, val self: Boolean, val entry: CalendarEntry)
    data class Day(val date: String, val holiday: String?, val rows: List<Row>)

    fun mondayOf(date: LocalDate): LocalDate = date.minusDays((date.dayOfWeek.value - DayOfWeek.MONDAY.value).toLong())

    /** Managers, HR and owners see their team (or everyone); others see "who's away". */
    fun wide(me: Me?): Boolean = me?.scopes("leave:read").orEmpty().any { it == "all" || it == "team" }

    fun defaultView(me: Me?): String = if (wide(me)) "team" else "org"

    /** "My team" for managers, "Everyone" for HR and owners (their team view is the whole company). */
    fun teamLabel(me: Me?): String = if (me?.scopes("leave:read").orEmpty().contains("all")) "Everyone" else "My team"

    /** Days with someone away or a public holiday, in date order; people in the server's order. */
    fun days(calendar: LeaveCalendar): List<Day> {
        val from = runCatching { LocalDate.parse(calendar.from) }.getOrNull() ?: return emptyList()
        val to = runCatching { LocalDate.parse(calendar.to) }.getOrNull() ?: return emptyList()
        val holidays = calendar.holidays.associate { it.date to it.name }
        val out = mutableListOf<Day>()
        var d = from
        while (!d.isAfter(to)) {
            val iso = d.toString()
            val rows = calendar.people.flatMap { p -> p.entries.filter { it.date == iso }.map { Row(p.name, p.self, it) } }
            if (rows.isNotEmpty() || iso in holidays) out += Day(iso, holidays[iso], rows)
            d = d.plusDays(1)
        }
        return out
    }

    fun halfDay(session: String): String? = when (session) {
        "am" -> "Morning"
        "pm" -> "Afternoon"
        else -> null
    }

    /** What TalkBack reads for one row: "Nadia Rahman: Annual leave, morning, waiting for approval". */
    fun spoken(row: Row): String = buildString {
        append(row.name)
        if (row.self) append(" (you)")
        append(": ")
        append(row.entry.label)
        halfDay(row.entry.session)?.let { append(", ${it.lowercase()}") }
        if (row.entry.status == "pending") append(", waiting for approval")
    }

    /** "16–29 Nov 2026", "30 Nov – 13 Dec 2026", "28 Dec 2026 – 10 Jan 2027" (the web's dateRange). */
    fun rangeLabel(from: LocalDate, to: LocalDate): String {
        val month = { d: LocalDate -> Formats.date(d).substringAfter(' ').substringBefore(' ') }
        return when {
            from.year == to.year && from.month == to.month -> "${from.dayOfMonth}–${to.dayOfMonth} ${month(to)} ${to.year}"
            from.year == to.year -> "${from.dayOfMonth} ${month(from)} – ${to.dayOfMonth} ${month(to)} ${to.year}"
            else -> "${Formats.date(from)} – ${Formats.date(to)}"
        }
    }
}

@Composable
fun LeaveCalendarScreen(ctx: ScreenContext) {
    val today = LocalDate.now(Formats.SINGAPORE)
    var fromText by rememberSaveable { mutableStateOf(LeaveCalendarLogic.mondayOf(today).toString()) }
    var view by rememberSaveable { mutableStateOf<String?>(null) }
    val shown = view ?: LeaveCalendarLogic.defaultView(ctx.me)
    val from = runCatching { LocalDate.parse(fromText) }.getOrDefault(LeaveCalendarLogic.mondayOf(today))
    val to = from.plusDays(LeaveCalendarLogic.SPAN_DAYS - 1)
    val loader = rememberLoader(ctx.connection.key, fromText, shown) {
        ctx.api.get("/api/v1/leave/calendar", LeaveCalendar.serializer(), mapOf("from" to from.toString(), "to" to to.toString(), "view" to shown))
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ScreenTitle(
            "Leave calendar",
            if (shown == "org") "Who's away. Leave types stay private where they're sensitive, such as sick leave."
            else "Your team's leave. Requests still waiting for approval are marked.",
        )
        if (LeaveCalendarLogic.wide(ctx.me)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.semantics { contentDescription = "Calendar view" }) {
                listOf("team" to LeaveCalendarLogic.teamLabel(ctx.me), "org" to "Who's away").forEach { (value, label) ->
                    FilterChip(
                        selected = shown == value, onClick = { view = value }, label = { Text(label) },
                        modifier = Modifier.testTag("calendar-view-$value"),
                        colors = FilterChipDefaults.filterChipColors(selectedContainerColor = Crow.colors.accent, selectedLabelColor = Crow.colors.onAccent),
                    )
                }
            }
        }
        Text(
            LeaveCalendarLogic.rangeLabel(from, to),
            style = Numeric.copy(fontSize = MaterialTheme.typography.titleMedium.fontSize),
            modifier = Modifier.testTag("calendar-range").semantics { liveRegion = LiveRegionMode.Polite },
        )
        // Wraps at large text sizes instead of squeezing three buttons onto one line.
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SecondaryButton("Previous", { fromText = from.minusDays(LeaveCalendarLogic.SPAN_DAYS).toString() },
                Modifier.semantics { contentDescription = "Previous two weeks" }.testTag("calendar-previous"))
            SecondaryButton("This week", { fromText = LeaveCalendarLogic.mondayOf(today).toString() }, Modifier.testTag("calendar-this-week"))
            SecondaryButton("Next", { fromText = from.plusDays(LeaveCalendarLogic.SPAN_DAYS).toString() },
                Modifier.semantics { contentDescription = "Next two weeks" }.testTag("calendar-next"))
        }
        LoadContent(loader, "Loading the calendar…") { calendar ->
            val days = LeaveCalendarLogic.days(calendar)
            if (days.isEmpty()) {
                EmptyState("Nobody is on leave in these two weeks", "Approved leave shows here. Try the next two weeks${if (LeaveCalendarLogic.wide(ctx.me)) ", or another view" else ""}.")
            }
            days.forEach { day -> CalendarDayCard(day, today.toString()) }
        }
    }
}

@Composable
private fun CalendarDayCard(day: LeaveCalendarLogic.Day, today: String) {
    CrowCard(modifier = Modifier.testTag("calendar-day-${day.date}"), border = if (day.date == today) 2.dp else 1.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Label(dayHeading(day.date) + if (day.date == today) " · today" else "", Modifier.weight(1f), color = Crow.colors.ink)
        }
        day.holiday?.let { Text(if (it.isBlank()) "Public holiday" else "Public holiday: $it", style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted, modifier = Modifier.padding(top = 2.dp)) }
        day.rows.forEachIndexed { i, row ->
            if (i > 0) Hairline(Modifier.padding(vertical = 2.dp))
            Row(
                Modifier.fillMaxWidth().heightIn(min = 40.dp).padding(top = 6.dp)
                    // One TalkBack item per person and day, read as a sentence.
                    .clearAndSetSemantics { contentDescription = LeaveCalendarLogic.spoken(row) }
                    .testTag("calendar-entry"),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Column(Modifier.weight(1f)) {
                    Text(row.name + if (row.self) " (you)" else "", style = MaterialTheme.typography.titleSmall)
                    Text(
                        listOfNotNull(row.entry.label, LeaveCalendarLogic.halfDay(row.entry.session)).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall, color = Crow.colors.muted,
                    )
                }
                if (row.entry.status == "pending") StatusChip("Waiting", Tone.Accent) else StatusChip("Approved", Tone.Success)
            }
        }
    }
}
