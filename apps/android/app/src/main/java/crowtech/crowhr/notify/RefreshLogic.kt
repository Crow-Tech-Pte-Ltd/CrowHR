package crowtech.crowhr.notify

import crowtech.crowhr.api.AppNotification
import crowtech.crowhr.core.Formats
import java.time.Duration
import java.time.Instant

/** Rules in apps/mobile-fixtures/background-refresh-cases.json. */
object RefreshLogic {
    const val TITLE = "Crow HR"

    data class Decision(val text: String?, val cursor: String?, val opens: String?, val count: Int = 0)

    fun text(count: Int) = if (count == 1) "You have 1 new item in Crow HR" else "You have $count new items in Crow HR"

    fun evaluate(cursor: String?, enabled: Boolean, items: List<AppNotification>): Decision {
        val newest = items.maxByOrNull { instant(it.createdAt) }?.createdAt
        val cursorAt = cursor?.let(::instant)
        val nextCursor = when {
            newest == null -> cursor
            cursorAt == null -> newest
            instant(newest) > cursorAt -> newest
            else -> cursor
        }
        if (cursorAt == null) return Decision(null, nextCursor, null)
        val fresh = items.filter { it.readAt == null && instant(it.createdAt) > cursorAt }
        if (fresh.isEmpty() || !enabled) return Decision(null, nextCursor, null)
        val opens = if (fresh.any { it.category == "approvals" }) "approvals" else "notifications"
        return Decision(text(fresh.size), nextCursor, opens, fresh.size)
    }

    /** Server-cursor mode: every item given is newer than the cursor; unread ones count. */
    fun newItems(items: List<AppNotification>, enabled: Boolean): Decision {
        val fresh = items.filter { it.readAt == null }
        if (fresh.isEmpty() || !enabled) return Decision(null, null, null)
        val opens = if (fresh.any { it.category == "approvals" }) "approvals" else "notifications"
        return Decision(text(fresh.size), null, opens, fresh.size)
    }

    private fun instant(value: String): Instant = Formats.parseInstant(value) ?: Instant.EPOCH
}

/** The WorkManager schedule, as data so it can be unit tested. */
object RefreshSchedule {
    data class Spec(val uniqueName: String, val interval: Duration, val requiresNetwork: Boolean)

    /** Android's minimum periodic interval; the OS may run it later (Doze, battery saver). */
    fun spec() = Spec("crowhr-background-refresh", Duration.ofMinutes(15), requiresNetwork = true)
}
