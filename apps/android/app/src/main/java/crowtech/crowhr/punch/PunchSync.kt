package crowtech.crowhr.punch

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import crowtech.crowhr.AppGraph
import crowtech.crowhr.api.ApiClient
import crowtech.crowhr.api.ApiException
import crowtech.crowhr.api.OfflineException
import crowtech.crowhr.connect.AppScreen
import java.util.concurrent.TimeUnit

/** SystemClock.elapsedRealtime (counts through sleep; resets on reboot) and the boot it belongs to. */
class AndroidMonotonicClock(private val context: Context) : MonotonicClock {
    override val bootCount: Int?
        get() = runCatching { android.provider.Settings.Global.getInt(context.contentResolver, android.provider.Settings.Global.BOOT_COUNT) }.getOrNull()

    override fun elapsedMillis(): Long = android.os.SystemClock.elapsedRealtime()
}

/** Sends queued punches through the bearer-token client. */
class ApiPunchSender(private val api: ApiClient) : PunchSender {
    override suspend fun send(request: PunchRequest): SendOutcome = try {
        val r = api.raw("POST", "/api/v1/attendance/punches", PunchQueue.encode(request))
        SendOutcome.Response(r.status, r.body)
    } catch (e: OfflineException) {
        SendOutcome.Network("offline")
    } catch (e: ApiException) {
        SendOutcome.Response(e.status, "")
    }
}

/**
 * Drains queued punches when connectivity returns: a one-time WorkManager job with a network
 * constraint and exponential backoff (add-mobile-apps design decision 5).
 */
object PunchSync {
    private const val NAME = "crowhr-punch-sync"

    fun request(context: Context) {
        val work = OneTimeWorkRequestBuilder<PunchSyncWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(NAME, ExistingWorkPolicy.KEEP, work)
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(NAME)
    }

    /** Drains every signed-in connection that has pending punches. True when nothing is left. */
    suspend fun drainAll(graph: AppGraph): Boolean {
        var allSent = true
        for (connection in graph.connections.all()) {
            if (!connection.isAvailable(AppScreen.Clock) || !graph.isSignedIn(connection)) continue
            val queue = graph.punchQueue(connection)
            if (queue.pending().isEmpty()) continue
            val result = queue.drain(graph.clock(), ApiPunchSender(graph.api(connection)), AndroidMonotonicClock(graph.context))
            if (result.stopReason == StopReason.Network) allSent = false
        }
        return allSent
    }
}

class PunchSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val graph = AppGraph.get(applicationContext)
        return if (PunchSync.drainAll(graph)) Result.success() else Result.retry()
    }
}
