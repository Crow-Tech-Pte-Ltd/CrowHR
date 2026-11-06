package crowtech.crowhr.notify

import crowtech.crowhr.Fixtures
import crowtech.crowhr.api.AppNotification
import crowtech.crowhr.arr
import crowtech.crowhr.obj
import crowtech.crowhr.str
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration

/**
 * Task 2.6 (mobile-apps spec "Notifications without remote push"): what counts as new, the
 * content-free text and the cursor (background-refresh-cases.json), and the WorkManager
 * schedule (≥ 15 minutes, network required). The worker posting a real notification on a
 * device is BackgroundRefreshWorkerTest.
 */
class BackgroundRefreshTest {
    private val fixture = Fixtures.load("background-refresh-cases.json")

    @Test fun everyFixtureCase() {
        for (case in fixture.arr("cases").map { it.jsonObject }) {
            val id = case.str("id")
            val items = case.arr("items").map {
                val o = it.jsonObject
                AppNotification(id = o.str("id")!!, category = o.str("category")!!, title = "(not shown)", createdAt = o.str("createdAt")!!, readAt = o.str("readAt"))
            }
            val decision = RefreshLogic.evaluate(case.str("cursor"), case["notificationsEnabled"]!!.jsonPrimitive.boolean, items)
            val expected = case.obj("expected")!!
            assertEquals("$id text", expected.str("post"), decision.text)
            assertEquals("$id cursor", expected.str("cursor"), decision.cursor)
            assertEquals("$id opens", expected.str("opens"), decision.opens)
        }
    }

    @Test fun textNeverContainsTitlesOrBodies() {
        val items = listOf(
            AppNotification(id = "n1", category = "leave", title = "Ahmad Ismail asked for 3 days of annual leave", body = "Bali trip", createdAt = "2026-11-02T03:00:00.000Z"),
        )
        val text = RefreshLogic.evaluate("2026-11-02T01:00:00.000Z", true, items).text!!
        assertEquals("You have 1 new item in Crow HR", text)
        assertFalse(text.contains("Ahmad") || text.contains("leave") || text.contains("Bali"))
    }

    @Test fun texts() {
        val t = fixture.obj("texts")!!
        assertEquals(t.str("one"), RefreshLogic.text(1))
        assertEquals(t.str("many")!!.replace("{count}", "7"), RefreshLogic.text(7))
        assertEquals(t.str("title"), RefreshLogic.TITLE)
    }

    @Test fun scheduleIsAtLeastFifteenMinutesAndNeedsNetwork() {
        val spec = RefreshSchedule.spec()
        assertEquals(fixture["minimumIntervalMinutes"]!!.jsonPrimitive.int.toLong(), spec.interval.toMinutes())
        assertTrue(spec.interval >= Duration.ofMinutes(15))
        assertTrue(spec.requiresNetwork)
        assertEquals("crowhr-background-refresh", spec.uniqueName)
    }
}
