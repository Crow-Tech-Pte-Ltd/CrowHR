package crowtech.crowhr.notify

import crowtech.crowhr.Fixtures
import crowtech.crowhr.api.AppNotification
import crowtech.crowhr.arr
import crowtech.crowhr.connect.AppScreen
import crowtech.crowhr.str
import crowtech.crowhr.ui.Destination
import crowtech.crowhr.ui.Destinations
import crowtech.crowhr.ui.OpenRequest
import crowtech.crowhr.ui.Route
import crowtech.crowhr.ui.Tab
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Where a notification opens: notification-link-cases.json, the app's screens, and the single-item rule. */
class NotificationLinksTest {
    private val fixture = Fixtures.load("notification-link-cases.json")
    private val everything: (AppScreen) -> Boolean = { true }

    @Test fun everyFixtureCase() {
        for (case in fixture.arr("cases").map { it.jsonObject }) {
            val link = case.str("link")
            val d = NotificationLinks.parse(link)
            assertEquals("opens for \"$link\"", case.str("opens"), d?.opens?.code)
            assertEquals("id for \"$link\"", case.str("id"), d?.id)
        }
    }

    @Test fun destinationsInTheApp() {
        assertEquals(Destination(Tab.Tasks), Destinations.forLink("/inbox?task=t1", everything))
        assertEquals(Destination(Tab.Leave), Destinations.forLink("/leave?request=r1", everything))
        assertEquals(Destination(Tab.Leave, listOf(Route.LeaveCalendar)), Destinations.forLink("/leave/team", everything))
        assertEquals(Destination(Tab.More, listOf(Route.Claims, Route.ClaimDetail("c1"))), Destinations.forLink("/claims/c1", everything))
        assertEquals(Destination(Tab.Pay, listOf(Route.PayslipDetail("p1"))), Destinations.forLink("/me/payslips/p1", everything))
        assertEquals(Destination(Tab.More, listOf(Route.Schedule)), Destinations.forLink("/schedules/me?week=2026-11-16", everything))
        assertEquals(Destination(Tab.More, listOf(Route.Profile)), Destinations.forLink("/me/profile", everything))
        assertEquals(Destination(Tab.Clock), Destinations.forLink("/attendance", everything))
        assertNull(Destinations.forLink("/settings/security", everything))
    }

    @Test fun aScreenTheServerDoesNotOfferOpensNothing() {
        val noClaims: (AppScreen) -> Boolean = { it != AppScreen.Claims }
        assertNull(Destinations.forLink("/claims/c1", noClaims))
        // Then a local notification falls back to its inbox.
        assertEquals(Destination(Tab.More, listOf(Route.Notifications)), Destinations.forRequest(OpenRequest("notifications", "/claims/c1"), noClaims))
        assertEquals(Destination(Tab.Tasks), Destinations.forRequest(OpenRequest("approvals", "/payroll/runs/r1"), everything))
        assertEquals(Destination(Tab.More, listOf(Route.Notifications)), Destinations.forRequest(OpenRequest("approvals"), { it != AppScreen.Approvals }))
        assertEquals(Destination(Tab.More), Destinations.inbox("notifications") { false })
    }

    private fun item(id: String, category: String, link: String) =
        AppNotification(id = id, category = category, title = "(not shown)", link = link, createdAt = "2026-11-13T01:00:00.000Z")

    @Test fun oneNewItemOpensItselfSeveralOpenTheInbox() {
        val one = RefreshLogic.newItems(listOf(item("n1", "claims", "/claims/c1")), enabled = true)
        val target = RefreshLogic.target(listOf("A" to one))!!
        assertEquals(RefreshLogic.Target("notifications", "A", "/claims/c1", "n1", 1), target)

        val two = RefreshLogic.newItems(listOf(item("n1", "claims", "/claims/c1"), item("n2", "approvals", "/inbox?task=t")), enabled = true)
        assertEquals(RefreshLogic.Target("approvals", "A", null, null, 2), RefreshLogic.target(listOf("A" to two)))

        // One new item on each of two connections: two items, so the inbox, and no one connection.
        val other = RefreshLogic.newItems(listOf(item("n3", "leave", "/leave")), enabled = true)
        assertEquals(RefreshLogic.Target("notifications", null, null, null, 2), RefreshLogic.target(listOf("A" to one, "B" to other)))

        // Nothing new anywhere (or notifications turned off): nothing to post.
        val none = RefreshLogic.newItems(emptyList(), enabled = true)
        val off = RefreshLogic.newItems(listOf(item("n1", "claims", "/claims/c1")), enabled = false)
        assertNull(RefreshLogic.target(listOf("A" to none, "B" to off)))
        // The one item on one connection, the other connection quiet.
        assertEquals("B", RefreshLogic.target(listOf("A" to none, "B" to other))!!.connectionKey)
    }

    @Test fun badges() {
        assertEquals("3 to approve", Destinations.badgeSpoken(Tab.Tasks, 3))
        assertEquals("1 unread notification", Destinations.badgeSpoken(Tab.More, 1))
        assertEquals("12 unread notifications", Destinations.badgeSpoken(Tab.More, 12))
        assertEquals("99", Destinations.badgeText(99))
        assertEquals("99+", Destinations.badgeText(100))
    }
}
