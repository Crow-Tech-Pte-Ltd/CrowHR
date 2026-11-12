package crowtech.crowhr.notify

import crowtech.crowhr.api.AppNotification
import crowtech.crowhr.core.Formats
import java.time.Duration
import java.time.Instant

/** Rules in apps/mobile-fixtures/background-refresh-cases.json. */
object RefreshLogic {
    const val TITLE = "Crow HR"

    /** [single]: the one new item when exactly one is new (tapping the notification opens it). */
    data class Decision(val text: String?, val cursor: String?, val opens: String?, val count: Int = 0, val single: AppNotification? = null)

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
        return Decision(text(fresh.size), nextCursor, opens, fresh.size, fresh.singleOrNull())
    }

    /** Server-cursor mode: every item given is newer than the cursor; unread ones count. */
    fun newItems(items: List<AppNotification>, enabled: Boolean): Decision {
        val fresh = items.filter { it.readAt == null }
        if (fresh.isEmpty() || !enabled) return Decision(null, null, null)
        val opens = if (fresh.any { it.category == "approvals" }) "approvals" else "notifications"
        return Decision(text(fresh.size), null, opens, fresh.size, fresh.singleOrNull())
    }

    /**
     * What tapping the one notification opens, from each signed-in connection's decision (by
     * connection key): the item itself when exactly one is new across all of them, else the
     * approvals inbox if any new item is an approval, else the notifications inbox; and the
     * connection, when all the news is for one (notification-link-cases.json rules).
     */
    data class Target(val opens: String, val connectionKey: String?, val link: String?, val notificationId: String?, val count: Int)

    fun target(decisions: List<Pair<String, Decision>>): Target? {
        val news = decisions.filter { it.second.text != null && it.second.count > 0 }
        if (news.isEmpty()) return null
        val total = news.sumOf { it.second.count }
        val opens = if (news.any { it.second.opens == "approvals" }) "approvals" else "notifications"
        val single = if (total == 1) news.single().second.single else null
        return Target(opens, news.map { it.first }.distinct().singleOrNull(), single?.link?.ifBlank { null }, single?.id, total)
    }

    private fun instant(value: String): Instant = Formats.parseInstant(value) ?: Instant.EPOCH
}

/** The WorkManager schedule, as data so it can be unit tested. */
object RefreshSchedule {
    data class Spec(val uniqueName: String, val interval: Duration, val requiresNetwork: Boolean)

    /** Android's minimum periodic interval; the OS may run it later (Doze, battery saver). */
    fun spec() = Spec("crowhr-background-refresh", Duration.ofMinutes(15), requiresNetwork = true)
}
