package crowtech.crowhr.punch

import crowtech.crowhr.Fixtures
import crowtech.crowhr.arr
import crowtech.crowhr.obj
import crowtech.crowhr.security.InMemoryKeyValueStore
import crowtech.crowhr.str
import crowtech.crowhr.strings
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Task 2.4 (mobile-apps spec "Offline clock-in queue"): FIFO, idempotency key reuse on retry,
 * 200 cap, late-send label, never drops. Every case in punch-queue-cases.json, then
 * persistence, the exact request body and concurrent drains.
 */
class PunchQueueTest {
    private val fixture = Fixtures.load("punch-queue-cases.json")

    /** Answers each request with the next fixture response and records what was sent. */
    private class FixtureSender(responses: List<JsonObject>) : PunchSender {
        private val queue = ArrayDeque(responses)
        val sent = mutableListOf<PunchRequest>()
        override suspend fun send(request: PunchRequest): SendOutcome {
            sent += request
            val r = queue.removeFirstOrNull() ?: error("No response left for ${request.idempotencyKey}")
            r.str("network")?.let { return SendOutcome.Network(it) }
            val body = r["body"]
            val text = when {
                body == null -> ""
                body is JsonPrimitive && body.isString -> body.content
                else -> body.toString()
            }
            return SendOutcome.Response(r["status"]!!.jsonPrimitive.int, text)
        }
    }

    @Test fun constantsMatchFixture() {
        val rules = fixture.obj("rules")!!
        assertEquals(rules["capacity"]!!.jsonPrimitive.int, PunchQueue.CAPACITY)
        val labels = fixture.obj("labels")!!
        assertEquals(labels.str("queueFull"), PunchQueue.QUEUE_FULL_MESSAGE)
        assertEquals(labels.str("late"), PunchLabels.LATE)
    }

    @Test fun everyFixtureCase() = runTest {
        for (case in fixture.arr("cases").map { it.jsonObject }) {
            val id = case.str("id")!!
            val queue = PunchQueue(KvPunchStore(InMemoryKeyValueStore(), "test"))
            for ((index, step) in case.arr("steps").map { it.jsonObject }.withIndex()) {
                val where = "$id step $index (${step.str("op")})"
                val expect = step.obj("expect") ?: JsonObject(emptyMap())
                when (step.str("op")) {
                    "enqueue" -> {
                        val result = queue.enqueue(step.str("kind")!!, Instant.parse(step.str("deviceTime")), key = step.str("key")!!)
                        assertEquals(where, expect.str("result"), result.code)
                    }
                    "enqueueMany" -> {
                        val count = step["count"]!!.jsonPrimitive.int
                        val digits = step["keyDigits"]!!.jsonPrimitive.int
                        val kinds = step["kinds"]!!.strings()
                        val start = Instant.parse(step.str("deviceTimeStart"))
                        val stepSeconds = step["stepSeconds"]!!.jsonPrimitive.int.toLong()
                        for (i in 1..count) {
                            val key = step.str("keyPrefix") + i.toString().padStart(digits, '0')
                            val r = queue.enqueue(kinds[(i - 1) % kinds.size], start.plusSeconds(stepSeconds * (i - 1)), key = key)
                            assertEquals("$where #$i", expect.str("result"), r.code)
                        }
                    }
                    "drain" -> {
                        val sender = FixtureSender(step.arr("responses").map { it.jsonObject })
                        val result = queue.drain(Instant.parse(step.str("now")), sender)
                        expect["requests"]?.let { reqs ->
                            val want = (reqs as kotlinx.serialization.json.JsonArray).map { it.jsonObject }
                            assertEquals("$where request keys", want.map { it.str("key") }, sender.sent.map { it.idempotencyKey })
                            assertEquals("$where queued flags", want.map { it["queued"]!!.jsonPrimitive.boolean }, sender.sent.map { it.queued })
                            sender.sent.forEach { assertEquals("$where sentAt", step.str("now"), it.sentAt) }
                        }
                        if (expect.containsKey("stopReason")) assertEquals("$where stop", expect.str("stopReason"), result.stopReason?.code)
                    }
                    else -> error("unknown op in $where")
                }
                expect["pending"]?.let { assertEquals("$where pending", it.strings(), queue.pending().map { p -> p.key }) }
                expect["pendingCount"]?.let { assertEquals("$where count", it.jsonPrimitive.int, queue.pending().size) }
                expect.str("firstPending")?.let { assertEquals("$where first", it, queue.pending().first().key) }
                expect.str("lastPending")?.let { assertEquals("$where last", it, queue.pending().last().key) }
                expect.obj("states")?.forEach { (key, state) -> assertEquals("$where state $key", state.jsonPrimitive.content, queue.find(key)!!.state) }
                expect["late"]?.let { late ->
                    val lateKeys = late.strings().toSet()
                    queue.all().forEach { p -> assertEquals("$where late ${p.key}", p.key in lateKeys, p.late) }
                }
                expect.obj("labels")?.forEach { (key, lines) -> assertEquals("$where labels $key", lines.strings(), PunchLabels.of(queue.find(key)!!)) }
            }
        }
    }

    @Test fun queueSurvivesRestartWithTheSameKeys() = runTest {
        val kv = InMemoryKeyValueStore()
        val first = PunchQueue(KvPunchStore(kv, "conn"))
        first.enqueue("in", Instant.parse("2026-11-02T00:58:00Z"), key = "restart-0001", monotonicMillis = 123_456, utcOffsetMinutes = 480)
        first.drain(Instant.parse("2026-11-02T00:58:30Z"), FixtureSender(listOf(Json.parseToJsonElement("""{"network":"offline"}""").jsonObject)))

        val again = PunchQueue(KvPunchStore(kv, "conn"))
        val p = again.pending().single()
        assertEquals("restart-0001", p.key)
        assertEquals(1, p.attempts)
        assertEquals(123_456L, p.monotonicMillis)
        assertEquals(480, p.utcOffsetMinutes)
        assertTrue(PunchQueue(KvPunchStore(kv, "other-connection")).pending().isEmpty())
    }

    @Test fun requestBodyIsWhatTheServerExpects() = runTest {
        val queue = PunchQueue(KvPunchStore(InMemoryKeyValueStore(), "c"))
        queue.enqueue("in", Instant.parse("2026-11-02T00:58:00Z"), key = "body-key-0001", location = PunchLocation(1.2834, 103.8607, 12.0))
        val sender = FixtureSender(listOf(Json.parseToJsonElement("""{"status":201,"body":{"status":"accepted","flags":[]}}""").jsonObject))
        queue.drain(Instant.parse("2026-11-02T00:58:20Z"), sender)
        val json = Json.parseToJsonElement(PunchQueue.encode(sender.sent.single())).jsonObject
        assertEquals(setOf("kind", "idempotencyKey", "deviceTime", "sentAt", "queued", "location"), json.keys)
        assertEquals("2026-11-02T00:58:00Z", json["deviceTime"]!!.jsonPrimitive.content)
        assertEquals(12.0, json["location"]!!.jsonObject["accuracyMetres"]!!.jsonPrimitive.content.toDouble(), 0.0)

        val noLocation = PunchQueue(KvPunchStore(InMemoryKeyValueStore(), "c"))
        noLocation.enqueue("out", Instant.parse("2026-11-02T00:58:00Z"), key = "body-key-0002")
        val s2 = FixtureSender(listOf(Json.parseToJsonElement("""{"status":201,"body":{"status":"accepted","flags":[]}}""").jsonObject))
        noLocation.drain(Instant.parse("2026-11-02T00:58:20Z"), s2)
        assertFalse(Json.parseToJsonElement(PunchQueue.encode(s2.sent.single())).jsonObject.containsKey("location"))
    }

    @Test fun generatedKeysAreValidForTheServerAndUnique() {
        val queue = PunchQueue(KvPunchStore(InMemoryKeyValueStore(), "c"))
        val keys = (1..50).map {
            (queue.enqueue("in", Instant.parse("2026-11-02T00:58:00Z")) as EnqueueResult.Queued).punch.key
        }
        assertEquals(50, keys.toSet().size)
        keys.forEach { assertTrue(it, it.matches(Regex("^[A-Za-z0-9._:-]{8,100}$"))) }
    }

    @Test fun concurrentDrainsSendEachPunchOnce() = runTest {
        val queue = PunchQueue(KvPunchStore(InMemoryKeyValueStore(), "c"))
        queue.enqueue("in", Instant.parse("2026-11-02T00:58:00Z"), key = "conc-key-0001")
        val gate = CompletableDeferred<Unit>()
        var calls = 0
        val sender = PunchSender {
            calls++
            gate.await()
            SendOutcome.Response(201, """{"status":"accepted","flags":[]}""")
        }
        val a = async { queue.drain(Instant.parse("2026-11-02T00:59:00Z"), sender) }
        val b = async { queue.drain(Instant.parse("2026-11-02T00:59:00Z"), sender) }
        gate.complete(Unit)
        listOf(a, b).awaitAll()
        assertEquals(1, calls)
        assertEquals("synced", queue.find("conc-key-0001")!!.state)
    }

    @Test fun onlyAnExplicitDiscardRemovesAPendingPunch() = runTest {
        val queue = PunchQueue(KvPunchStore(InMemoryKeyValueStore(), "c"))
        queue.enqueue("in", Instant.parse("2026-11-02T00:58:00Z"), key = "keep-key-0001")
        repeat(5) {
            queue.drain(Instant.parse("2026-11-02T01:00:00Z"), FixtureSender(listOf(Json.parseToJsonElement("""{"status":500}""").jsonObject)))
        }
        assertEquals(5, queue.find("keep-key-0001")!!.attempts)
        assertEquals("keep-key-0001", queue.pending().single().key)
        assertTrue(queue.discard("keep-key-0001"))
        assertNull(queue.find("keep-key-0001"))
    }

    @Test fun settledHistoryIsTrimmedButPendingNeverIs() = runTest {
        val queue = PunchQueue(KvPunchStore(InMemoryKeyValueStore(), "c"))
        val ok = Json.parseToJsonElement("""{"status":201,"body":{"status":"accepted","flags":[]}}""").jsonObject
        for (i in 1..(PunchQueue.HISTORY_LIMIT + 20)) {
            queue.enqueue("in", Instant.parse("2026-11-02T00:58:00Z"), key = "hist-key-%04d".format(i))
            queue.drain(Instant.parse("2026-11-02T00:58:10Z"), FixtureSender(listOf(ok)))
        }
        queue.enqueue("out", Instant.parse("2026-11-02T00:59:00Z"), key = "hist-pending-1")
        assertEquals(PunchQueue.HISTORY_LIMIT + 1, queue.all().size)
        assertEquals("hist-pending-1", queue.pending().single().key)
    }

    @Test fun clockStateFollowsTheLastPunch() {
        val queue = PunchQueue(KvPunchStore(InMemoryKeyValueStore(), "c"))
        assertEquals("in", queue.nextKind(serverClockedIn = false))
        assertEquals("out", queue.nextKind(serverClockedIn = true))
        queue.enqueue("in", Instant.parse("2026-11-02T00:58:00Z"), key = "state-key-01")
        assertEquals("out", queue.nextKind(serverClockedIn = false))
    }
}
