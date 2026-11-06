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
    private val fetch: suspend (SavedConnection) -> List<AppNotification> = { c ->
        graph.api(c).get(
            "/api/v1/notifications",
            NotificationPage.serializer(),
            mapOf("unread" to "true", "sort" to "-createdAt", "pageSize" to "50"),
        ).items
    },
) {
    suspend fun run(): Boolean {
        var ok = true
        var total = 0
        var opens: String? = null
        for (connection in graph.connections.all()) {
            if (!graph.isSignedIn(connection)) continue
            val items = runCatching { fetch(connection) }.getOrElse { ok = false; continue }
            val decision = RefreshLogic.evaluate(graph.settings.refreshCursor(connection.key), graph.settings.notificationsEnabled, items)
            graph.settings.setRefreshCursor(connection.key, decision.cursor)
            if (decision.text != null) {
                total += decision.count
                opens = if (opens == "approvals" || decision.opens == "approvals") "approvals" else decision.opens
            }
        }
        if (total > 0) Notifications.post(graph.context, RefreshLogic.text(total), opens ?: "notifications")
        runCatching { PunchSync.drainAll(graph) }
        return ok
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
        context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

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
