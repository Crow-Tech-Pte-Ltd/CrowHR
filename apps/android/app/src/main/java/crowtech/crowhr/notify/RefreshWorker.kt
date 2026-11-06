package crowtech.crowhr.notify

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.app.Notification
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import crowtech.crowhr.AppGraph
import crowtech.crowhr.MainActivity
import crowtech.crowhr.R
import crowtech.crowhr.api.AppNotification
import crowtech.crowhr.api.NotificationPage
import crowtech.crowhr.connect.SavedConnection
import crowtech.crowhr.punch.PunchSync

/** Schedules the periodic refresh (no remote push in v1: add-mobile-apps design decision 6a). */
object RefreshScheduler {
    fun schedule(context: Context) {
        val spec = RefreshSchedule.spec()
        val request = PeriodicWorkRequestBuilder<RefreshWorker>(spec.interval)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(if (spec.requiresNetwork) NetworkType.CONNECTED else NetworkType.NOT_REQUIRED)
                    .build(),
            )
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(spec.uniqueName, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(RefreshSchedule.spec().uniqueName)
    }
}

/**
 * One refresh: for each signed-in connection, read unread notifications, decide what is new,
 * post one content-free local notification and move the cursor. Also sends queued punches.
 */
class RefreshRunner(
    private val graph: AppGraph,
    /** `GET /api/v1/notifications` with the given query (replaced in tests). */
    private val list: suspend (SavedConnection, Map<String, String?>) -> NotificationPage = { c, query ->
        graph.api(c).get("/api/v1/notifications", NotificationPage.serializer(), query)
    },
) {
    /**
     * Servers with the `since` cursor: the stored value is "srv:<cursor>" and only newer items
     * come back, oldest first, paged until empty. Older servers (no `cursor` field): the newest
     * createdAt seen is stored and compared (background-refresh-cases.json).
     */
    private suspend fun decide(connection: SavedConnection, stored: String?, enabled: Boolean): RefreshLogic.Decision {
        if (stored != null && stored.startsWith(SERVER_PREFIX)) {
            var cursor = stored.removePrefix(SERVER_PREFIX)
            val fresh = mutableListOf<AppNotification>()
            for (page in 1..MAX_PAGES) {
                val r = list(connection, mapOf("since" to cursor, "pageSize" to "50"))
                if (r.supportsCursor && r.cursor != null) cursor = r.cursor
                fresh += r.items
                if (r.items.isEmpty() || !r.supportsCursor) break
            }
            return RefreshLogic.newItems(fresh, enabled).copy(cursor = SERVER_PREFIX + cursor)
        }
        val r = list(connection, mapOf("unread" to "true", "sort" to "-createdAt", "pageSize" to "50"))
        if (r.supportsCursor && stored == null) {
            // First refresh after sign-in: start from here; what's already there isn't news.
            val baseline = list(connection, mapOf("pageSize" to "1"))
            return RefreshLogic.Decision(null, baseline.cursor?.let { SERVER_PREFIX + it }, null)
        }
        val legacy = RefreshLogic.evaluate(stored, enabled, r.items)
        if (!r.supportsCursor) return legacy
        // Upgraded server: decide this once by date, then switch to its cursor.
        val baseline = list(connection, mapOf("pageSize" to "1"))
        return legacy.copy(cursor = baseline.cursor?.let { SERVER_PREFIX + it } ?: legacy.cursor)
    }

    suspend fun run(): Boolean {
        var ok = true
        var total = 0
        var opens: String? = null
        for (connection in graph.connections.all()) {
            if (!graph.isSignedIn(connection)) continue
            val decision = runCatching {
                decide(connection, graph.settings.refreshCursor(connection.key), graph.settings.notificationsEnabled)
            }.getOrElse { ok = false; continue }
            if (decision.cursor != null) graph.settings.setRefreshCursor(connection.key, decision.cursor)
            if (decision.text != null) {
                total += decision.count
                opens = if (opens == "approvals" || decision.opens == "approvals") "approvals" else decision.opens
            }
        }
        if (total > 0) Notifications.post(graph.context, RefreshLogic.text(total), opens ?: "notifications")
        runCatching { PunchSync.drainAll(graph) }
        return ok
    }

    companion object {
        const val SERVER_PREFIX = "srv:"
        private const val MAX_PAGES = 10
    }
}

class RefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val ok = RefreshRunner(AppGraph.get(applicationContext)).run()
        return if (ok) Result.success() else Result.retry()
    }
}

object Notifications {
    const val CHANNEL = "updates"
    const val ID = 1
    const val EXTRA_OPEN = "crowtech.crowhr.open"

    fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(CHANNEL, context.getString(R.string.notification_channel_updates), NotificationManager.IMPORTANCE_DEFAULT)
        channel.description = context.getString(R.string.notification_channel_updates_description)
        manager.createNotificationChannel(channel)
    }

    fun canPost(context: Context): Boolean =
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        } else {
            context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()
        }

    /** Title "Crow HR", text a count only: no names, no amounts, no dates. */
    fun post(context: Context, text: String, opens: String) {
        if (!canPost(context)) return
        ensureChannel(context)
        val intent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(EXTRA_OPEN, opens)
        val pending = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_crowhr)
            .setContentTitle(RefreshLogic.TITLE)
            .setContentText(text)
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .build()
        context.getSystemService(NotificationManager::class.java).notify(ID, notification)
    }
}
