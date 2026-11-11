package crowtech.crowhr.punch

import crowtech.crowhr.core.CrowJson
import crowtech.crowhr.security.KeyValueStore
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.time.Duration
import java.time.Instant
import java.util.UUID

@Serializable
data class PunchLocation(val latitude: Double, val longitude: Double, val accuracyMetres: Double? = null)

/**
 * One tap on Clock in / Clock out. Everything needed to send it later is captured at tap time:
 * the idempotency key, device wall-clock time, monotonic time since boot, UTC offset and,
 * only when the organisation's policy asks and the user allowed it, the location.
 */
@Serializable
data class QueuedPunch(
    val key: String,
    val kind: String,
    val deviceTime: String,
    val monotonicMillis: Long? = null,
    /** Settings.Global.BOOT_COUNT at the tap: [monotonicMillis] is only comparable within one boot. */
    val bootCount: Int? = null,
    /** Kept on the device for display and support; never sent (the server has no such field). */
    val utcOffsetMinutes: Int? = null,
    val location: PunchLocation? = null,
    val state: String = PunchQueue.PENDING,
    val attempts: Int = 0,
    val lastAttemptAt: String? = null,
    val sentAt: String? = null,
    val flags: List<String> = emptyList(),
    val message: String? = null,
    val late: Boolean = false,
    val serverId: String? = null,
) {
    val isPending: Boolean get() = state == PunchQueue.PENDING
    /** Sent and accepted (possibly flagged): nothing left for the employee to do. */
    val isSettled: Boolean get() = state == PunchQueue.SYNCED || state == PunchQueue.FLAGGED
}

/** Body of `POST /api/v1/attendance/punches`. */
@Serializable
data class PunchRequest(
    val kind: String,
    val idempotencyKey: String,
    val deviceTime: String,
    val sentAt: String,
    val queued: Boolean,
    val location: PunchLocation? = null,
    val source: String = "android",
    /** Monotonic ms from the tap to this send; omitted when the phone rebooted in between. */
    val elapsedMs: Long? = null,
)

/** The phone's monotonic clock (SystemClock.elapsedRealtime) and which boot it belongs to. */
interface MonotonicClock {
    val bootCount: Int?
    fun elapsedMillis(): Long

    /** Unknown boot: elapsed time is never sent. */
    object None : MonotonicClock {
        override val bootCount: Int? = null
        override fun elapsedMillis(): Long = 0
    }
}

sealed interface SendOutcome {
    data class Response(val status: Int, val body: String) : SendOutcome
    data class Network(val kind: String) : SendOutcome
}

fun interface PunchSender {
    suspend fun send(request: PunchRequest): SendOutcome
}

sealed interface EnqueueResult {
    val code: String
    data class Queued(val punch: QueuedPunch) : EnqueueResult { override val code get() = "queued" }
    data object QueueFull : EnqueueResult { override val code get() = "queue_full" }
}

enum class StopReason(val code: String) { Network("network"), AuthRequired("auth_required") }

data class DrainResult(val sent: Int, val stopReason: StopReason?)

interface PunchStore {
    fun load(): List<QueuedPunch>
    fun save(punches: List<QueuedPunch>)
}

/** Kept in the encrypted store, one queue per saved connection. */
class KvPunchStore(private val kv: KeyValueStore, connectionKey: String) : PunchStore {
    private val name = "punches.$connectionKey"
    private val serializer = ListSerializer(QueuedPunch.serializer())
    override fun load(): List<QueuedPunch> =
        kv.get(name)?.let { runCatching { CrowJson.decodeFromString(serializer, it) }.getOrNull() } ?: emptyList()
    override fun save(punches: List<QueuedPunch>) = kv.put(name, CrowJson.encodeToString(serializer, punches))
}

@Serializable
private data class PunchReply(val id: String? = null, val status: String? = null, val flags: List<String> = emptyList())

@Serializable private data class ErrorReply(val error: ErrorDetail? = null)
@Serializable private data class ErrorDetail(val code: String? = null, val message: String? = null)

/**
 * Append-only offline queue (add-mobile-apps design decision 5; rules in
 * apps/mobile-fixtures/punch-queue-cases.json). Drained strictly in tap order; a punch that
 * can't be delivered stops the drain so later punches never overtake it; the idempotency key
 * is reused on every retry; nothing pending is ever dropped or edited except by an explicit
 * [discard]. Retry timing comes from WorkManager's exponential backoff ([PunchSync]).
 */
class PunchQueue(private val store: PunchStore) {
    companion object {
        const val CAPACITY = 200
        const val HISTORY_LIMIT = 100
        const val PENDING = "pending"
        const val SYNCED = "synced"
        const val FLAGGED = "flagged"
        const val REJECTED = "rejected"
        const val QUEUE_FULL_MESSAGE = "200 clock-ins are waiting to send. Connect to the internet so they can be sent, then try again."
        private val QUEUED_AFTER: Duration = Duration.ofSeconds(60)
        private val LATE_AFTER: Duration = Duration.ofDays(7)

        fun encode(request: PunchRequest): String = CrowJson.encodeToString(PunchRequest.serializer(), request)

        /**
         * What "On this phone" lists, newest first: every unsent and refused punch, and the last
         * [recent] sent ones (as iOS). The queue keeps up to [HISTORY_LIMIT] sent punches, which
         * made the Clock screen a long scroll after a few weeks.
         */
        fun shown(all: List<QueuedPunch>, recent: Int = 10): List<QueuedPunch> {
            val sent = all.filter { it.state == SYNCED || it.state == FLAGGED }.takeLast(recent).map { it.key }.toSet()
            return all.filter { !it.isSettled || it.key in sent }.asReversed()
        }
    }

    private val mutex = Mutex()
    private val lock = Any()

    /** Bumps on every change, so screens notice punches sent by the background worker. */
    val changes = kotlinx.coroutines.flow.MutableStateFlow(0)

    fun all(): List<QueuedPunch> = synchronized(lock) { store.load() }
    fun pending(): List<QueuedPunch> = all().filter { it.isPending }
    fun find(key: String): QueuedPunch? = all().firstOrNull { it.key == key }

    fun enqueue(
        kind: String,
        deviceTime: Instant,
        key: String = UUID.randomUUID().toString(),
        monotonicMillis: Long? = null,
        utcOffsetMinutes: Int? = null,
        bootCount: Int? = null,
        location: PunchLocation? = null,
    ): EnqueueResult = synchronized(lock) {
        val list = store.load()
        if (list.count { it.isPending } >= CAPACITY) return EnqueueResult.QueueFull
        val punch = QueuedPunch(
            key = key, kind = kind, deviceTime = deviceTime.toString(), monotonicMillis = monotonicMillis,
            utcOffsetMinutes = utcOffsetMinutes, location = location, bootCount = bootCount,
        )
        store.save(trim(list + punch))
        changes.value++
        EnqueueResult.Queued(punch)
    }

    /** The user explicitly gave up on a punch (shown with a confirmation). */
    fun discard(key: String): Boolean = synchronized(lock) {
        val list = store.load()
        if (list.none { it.key == key }) return false
        store.save(list.filterNot { it.key == key })
        changes.value++
        true
    }

    /** The user read a refused punch's reason and dismisses it. Only refused punches can be dismissed. */
    fun dismiss(key: String): Boolean = synchronized(lock) {
        val list = store.load()
        if (list.none { it.key == key && it.state == REJECTED }) return false
        store.save(list.filterNot { it.key == key })
        changes.value++
        true
    }

    /** Whether the next tap is a clock-in or a clock-out: the newest unsent punch wins. */
    fun nextKind(serverClockedIn: Boolean): String {
        val last = pending().lastOrNull() ?: return if (serverClockedIn) "out" else "in"
        return if (last.kind == "in") "out" else "in"
    }

    suspend fun drain(now: Instant, sender: PunchSender, monotonic: MonotonicClock = MonotonicClock.None): DrainResult = mutex.withLock {
        var sent = 0
        while (true) {
            val head = pending().firstOrNull() ?: return DrainResult(sent, null)
            val deviceTime = Instant.parse(head.deviceTime)
            val request = PunchRequest(
                kind = head.kind,
                idempotencyKey = head.key,
                deviceTime = head.deviceTime,
                sentAt = now.toString(),
                queued = head.attempts > 0 || Duration.between(deviceTime, now) >= QUEUED_AFTER,
                location = head.location,
                elapsedMs = elapsedSinceTap(head, monotonic),
            )
            val outcome = sender.send(request)
            sent++
            val late = Duration.between(deviceTime, now) > LATE_AFTER
            val attempted = head.copy(lastAttemptAt = now.toString())
            when (outcome) {
                is SendOutcome.Network -> {
                    replace(attempted.copy(attempts = head.attempts + 1))
                    return DrainResult(sent, StopReason.Network)
                }
                is SendOutcome.Response -> when {
                    outcome.status == 401 -> {
                        replace(attempted)
                        return DrainResult(sent, StopReason.AuthRequired)
                    }
                    outcome.status in 200..299 -> {
                        val reply = runCatching { CrowJson.decodeFromString(PunchReply.serializer(), outcome.body) }.getOrNull()
                        if (reply?.status != "accepted" && reply?.status != "flagged") {
                            // Possibly stored, possibly a captive portal: retry with the same key.
                            replace(attempted.copy(attempts = head.attempts + 1))
                            return DrainResult(sent, StopReason.Network)
                        }
                        val flagged = reply.status == "flagged" || reply.flags.isNotEmpty()
                        replace(
                            attempted.copy(
                                state = if (flagged) FLAGGED else SYNCED, flags = reply.flags, late = late,
                                sentAt = now.toString(), serverId = reply.id, attempts = head.attempts + 1,
                            ),
                        )
                    }
                    outcome.status == 408 || outcome.status == 429 || outcome.status >= 500 -> {
                        replace(attempted.copy(attempts = head.attempts + 1))
                        return DrainResult(sent, StopReason.Network)
                    }
                    else -> {
                        val message = runCatching { CrowJson.decodeFromString(ErrorReply.serializer(), outcome.body).error?.message }.getOrNull()
                        replace(
                            attempted.copy(
                                state = REJECTED, message = message?.takeIf { it.isNotBlank() }, late = late,
                                sentAt = now.toString(), attempts = head.attempts + 1,
                            ),
                        )
                    }
                }
            }
        }
        @Suppress("UNREACHABLE_CODE")
        DrainResult(sent, null)
    }

    private fun replace(punch: QueuedPunch) = synchronized(lock) {
        store.save(trim(store.load().map { if (it.key == punch.key) punch else it }))
        changes.value++
    }

    /** Keeps every pending punch and the newest [HISTORY_LIMIT] settled ones. */
    private fun elapsedSinceTap(p: QueuedPunch, clock: MonotonicClock): Long? {
        val tapped = p.monotonicMillis ?: return null
        val boot = p.bootCount ?: return null
        if (clock.bootCount != boot) return null
        val elapsed = clock.elapsedMillis() - tapped
        return elapsed.takeIf { it >= 0 }
    }

    /**
     * Keeps every pending punch, every refused one (it shows the server's reason until the user
     * dismisses it) and the newest [HISTORY_LIMIT] synced or flagged ones.
     */
    private fun trim(list: List<QueuedPunch>): List<QueuedPunch> {
        val settled = list.filter { it.state == SYNCED || it.state == FLAGGED }
        if (settled.size <= HISTORY_LIMIT) return list
        val drop = settled.take(settled.size - HISTORY_LIMIT).map { it.key }.toSet()
        return list.filterNot { it.key in drop }
    }
}

/** Per-punch status lines (punch-queue-cases.json "labels"). */
object PunchLabels {
    const val LATE = "Sent late. Your manager may need to review it"
    private val FLAG_NAMES = mapOf(
        "clock_skew" to "device clock differs from the server",
        "late_sync" to "sent late",
        "outside_location" to "outside the office area",
        "no_location" to "no location",
        "ip_not_allowed" to "not on the office network",
    )

    fun of(p: QueuedPunch): List<String> {
        val status = when (p.state) {
            PunchQueue.PENDING -> if (p.attempts == 0) "Waiting to send" else "Not sent yet. The app will retry automatically."
            PunchQueue.SYNCED -> "Synced"
            PunchQueue.FLAGGED ->
                if (p.flags.isEmpty()) "Synced. Flagged for review"
                else "Synced. Flagged: " + p.flags.joinToString(", ") { FLAG_NAMES[it] ?: it }
            PunchQueue.REJECTED -> "Not accepted: " + (p.message ?: "the server refused this punch.")
            else -> p.state
        }
        return if (p.late && !p.isPending) listOf(status, LATE) else listOf(status)
    }
}
