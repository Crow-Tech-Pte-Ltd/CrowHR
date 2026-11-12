package crowtech.crowhr

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import crowtech.crowhr.core.Formats
import crowtech.crowhr.notify.Notifications
import crowtech.crowhr.notify.RefreshLogic
import crowtech.crowhr.ui.screens.SwapLogic
import crowtech.crowhr.ui.screens.dayHeading
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.time.LocalDate
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The web features the app gained for parity (leave for a child, claim drafts and foreign
 * currency, the leave calendar, shift swaps and pickups, notifications that open their item and
 * tab badges), in the real app against the local seeded server, with the network allow-list check.
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class ParityJourneyTest {
    @get:Rule val compose: ComposeTestRule = createEmptyComposeRule()
    private val j = Journey(compose)

    @Before fun setUp() = j.setUp()
    @After fun tearDown() = j.tearDown()

    /** Opens the dropdown [tag] and chooses the item that reads exactly [text]. */
    private fun pick(tag: String, text: String) {
        j.tap(tag)
        j.waitForText(text, substring = false)
        compose.onNode(hasText(text) and !hasTestTag(tag)).performClick()
    }

    @Test fun infantCareLeaveForAChild() {
        val (childId, childName) = TestServer.ensureChildOfNadia()
        TestServer.withdrawPendingLeave(TestServer.nextWorkingDay())
        try {
            j.connectAndSignIn(TestServer.NADIA)
            j.tap("tab-leave")
            j.waitFor("apply-leave")
            j.tap("apply-leave")
            j.waitFor("leave-type")
            pick("leave-type", "Unpaid infant care leave")
            j.waitFor("leave-child")
            // Sending without the child says what's missing; the quote waits for it too.
            j.tap("send-leave")
            j.waitForText("Choose the child this leave is for.")
            assertTrue(compose.onAllNodesWithTag("leave-quote").fetchSemanticsNodes().isEmpty())
            j.tap("leave-child")
            compose.onNodeWithTag("leave-child-$childId").performClick()
            j.waitFor("leave-quote")
            j.untilTexts("quote of 1 day") { it.contains("1 day") }
            j.tap("send-leave")
            j.waitFor("leave-done")
            j.tap("leave-done")
            j.waitForText("Unpaid infant care leave · $childName")
            j.waitForText("Waiting for approval")
        } finally {
            TestServer.withdrawPendingLeave(TestServer.nextWorkingDay())
        }
    }

    @Test fun foreignCurrencyDraftChangedSubmittedWithdrawnAndCopied() {
        TestServer.clearClaimsOfAhmad()
        j.connectAndSignIn(TestServer.AHMAD)
        j.tap("tab-more")
        j.tap("more-claims")
        j.waitFor("new-claim")
        j.tap("new-claim")
        j.waitFor("claim-type-0")
        pick("claim-type-0", "Transport")
        compose.onNodeWithTag("claim-merchant-0").performScrollTo().performTextInput("Grab Penang")
        pick("claim-currency-0", "MYR · Malaysian ringgit")
        compose.onNodeWithTag("claim-amount-0").performScrollTo().performTextInput("50.00")
        compose.onNodeWithTag("claim-rate-0").performScrollTo().performTextInput("0.301234")
        // MYR 50.00 × 0.301234 = S$15.0617 → S$15.06, as the server will store it.
        j.untilTexts("S$ preview") { it.contains("= S$15.06") }
        compose.onNode(hasTestTag("claim-total")).assertExists()
        j.untilTexts("total") { it.contains("S$15.06") }
        j.tap("save-claim-draft")
        j.waitFor("claim-done")
        compose.onNodeWithText("Saved for later").assertExists()
        j.tap("claim-open-draft")

        // The draft in the app: change it, then submit it.
        j.waitFor("claim-edit")
        compose.onNodeWithText("Draft").assertExists()
        j.waitForText("MYR 50.00 at 0.301234", substring = true)
        j.tap("claim-edit")
        j.waitFor("claim-amount-0")
        j.untilTexts("draft back in the form") { it.contains("50.00") && it.contains("0.301234") && it.contains("Grab Penang") }
        compose.onNodeWithTag("claim-amount-0").performScrollTo().performTextClearance()
        compose.onNodeWithTag("claim-amount-0").performTextInput("60")
        j.untilTexts("new S$ preview") { it.contains("= S$18.07") }
        j.tap("save-claim-draft")
        j.waitFor("claim-done")
        j.tap("claim-done")
        j.waitFor("claim-submit")
        j.untilTexts("changed total") { it.contains("S$18.07") }
        j.tap("claim-submit")
        j.waitFor("claim-withdraw")
        compose.onNodeWithText("Waiting for approval").assertExists()

        // Withdraw it, then copy it into a new draft, which opens for changes.
        j.tap("claim-withdraw")
        j.tap("claim-withdraw-confirm")
        j.waitFor("claim-copy")
        compose.onNodeWithText("Withdrawn").assertExists()
        j.tap("claim-copy")
        j.waitFor("claim-amount-0")
        j.untilTexts("copy in the form") { it.contains("Change draft") && it.contains("60.00") }
        j.tap("save-claim-draft")
        j.waitFor("claim-done")
        j.tap("claim-done")
        j.waitFor("claim-delete")
        compose.onNodeWithText("Draft").assertExists()
        j.tap("claim-delete")
        j.tap("claim-delete-confirm")
        j.waitFor("new-claim")
        j.untilTexts("claims list") { it.contains("Withdrawn") }
    }

    @Test fun managerSeesTheTeamCalendar() {
        j.connectAndSignIn(TestServer.KAIWEN)
        j.tap("tab-leave")
        j.waitFor("leave-calendar")
        compose.onNodeWithText("Team calendar").assertExists()
        j.tap("leave-calendar")
        j.waitFor("calendar-range")
        // The seed: Nadia's sick day this week and her annual leave next week.
        compose.waitUntil(20_000) { compose.onAllNodes(hasContentDescription("Nadia Rahman:", substring = true)).fetchSemanticsNodes().isNotEmpty() }
        val range = j.textOf("calendar-range")
        j.tap("calendar-next")
        j.untilTexts("next two weeks") { texts -> texts.none { it == range } }
        j.tap("calendar-this-week")
        j.untilTexts("back to this week") { it.contains(range) }
        j.tap("calendar-view-org")
        j.waitFor("calendar-range")
        compose.onNodeWithText("Who's away. Leave types stay private", substring = true).assertExists()
    }

    @Test fun giveAShiftAwayAndAskForAnOpenShift() {
        val monday = TestServer.ensurePublishedShift()
        val shiftId = TestServer.nurulsShiftId(monday)
        val openId = TestServer.ensureOpenShift(monday)
        TestServer.cancelPendingSwaps(TestServer.NURUL)
        try {
            j.connectAndSignIn(TestServer.NURUL)
            j.tap("tab-more")
            j.tap("more-schedule")
            j.waitFor("offer-$shiftId")
            j.tap("offer-$shiftId")
            j.waitFor("offer-send")
            // A swap needs their shift; a give-away only the colleague.
            j.tap("offer-send")
            j.waitForText("Choose the colleague to offer it to.")
            j.tap("offer-kind-giveaway")
            pick("offer-colleague", "Marcus Lim")
            compose.onNodeWithTag("offer-note").performScrollTo().performTextInput("Family dinner, sorry")
            j.tap("offer-send")
            j.waitFor("offer-done")
            j.tap("offer-done")
            j.waitForText("Give away ${dayHeading(monday)}", substring = true)
            j.waitForText("Waiting for colleague")
            compose.onAllNodes(hasText("Swap requested")).fetchSemanticsNodes().isNotEmpty().let(::assertTrue)

            j.tap("pickup-$openId")
            j.waitForText("Asked. Your manager will approve it.")
            // The server stops listing an open shift someone asked for; the request shows instead.
            j.waitForText("Pick up ${dayHeading(LocalDate.parse(monday).plusDays(1).toString())}", substring = true)
            val pickup = TestServer.get("/api/v1/scheduling/swaps", TestServer.token(TestServer.NURUL)).jsonObject["items"]!!.jsonArray
                .map { it.jsonObject }.first { it["kind"]!!.jsonPrimitive.content == "pickup" && it["status"]!!.jsonPrimitive.content == "pending_approval" }
            val pickupId = pickup["id"]!!.jsonPrimitive.content
            j.waitFor("swap-cancel-$pickupId")
            j.tap("swap-cancel-$pickupId")
            j.waitForText("Request cancelled.")
            j.untilTexts("pickup button back") { j.has("pickup-$openId") }
        } finally {
            TestServer.cancelPendingSwaps(TestServer.NURUL)
        }
    }

    @Test fun colleagueAcceptsAnOffer() {
        val monday = TestServer.ensurePublishedShift()
        TestServer.cancelPendingSwaps(TestServer.NURUL)
        val offer = TestServer.offerToMarcus(TestServer.nurulsShiftId(monday))
        try {
            j.connectAndSignIn(TestServer.MARCUS)
            j.tap("tab-more")
            j.tap("more-schedule")
            j.waitFor("swap-offer-$offer")
            j.waitForText("Nurul Huda offers you their shift on ${dayHeading(monday)}", substring = true)
            j.waitForText("Family dinner, sorry", substring = true)
            j.tap("swap-accept")
            j.waitForText("Accepted. Your manager will approve it.")
            j.waitUntilGone("swap-offer-$offer")
            val status = TestServer.get("/api/v1/scheduling/swaps", TestServer.token(TestServer.NURUL)).jsonObject["items"]!!.jsonArray
                .map { it.jsonObject }.first { it["id"]!!.jsonPrimitive.content == offer }["status"]!!.jsonPrimitive.content
            assertEquals("pending_approval", status)
            assertEquals("Waiting for approval", SwapLogic.status(status).first)
        } finally {
            TestServer.cancelPendingSwaps(TestServer.NURUL)
        }
    }

    @Test fun tabBadgesAndANotificationThatOpensItsItem() {
        // An unread notification for Nadia: her request was approved (it links to /leave?request=…).
        val day = TestServer.freeWeekday(9, offsetDays = (0..15).random().toLong())
        TestServer.approvedLeaveForNadia(day)
        val notification = TestServer.get("/api/v1/notifications?unread=true&sort=-createdAt&pageSize=1", TestServer.token(TestServer.NADIA))
            .jsonObject["items"]!!.jsonArray.first().jsonObject
        j.connectAndSignIn(TestServer.NADIA)
        j.waitFor("badge-more", unmerged = true)
        compose.onNode(hasContentDescription("unread notification", substring = true)).assertExists()
        // Tapping it in the inbox opens what it's about: the leave request, on the Leave tab.
        j.tap("tab-more")
        j.tap("more-notifications")
        j.waitFor("notification-row")
        // The newest first: the one just sent (earlier runs may have left others with the same title).
        compose.onAllNodes(hasText(notification["title"]!!.jsonPrimitive.content))[0].performScrollTo().performClick()
        j.waitFor("apply-leave")
        j.waitForText(Formats.date(day), substring = true)

        // A local notification for one claim decision opens that claim. The same intent as the
        // notification's tap (Notifications.openIntent), sent while the app is open.
        val nadia = TestServer.token(TestServer.NADIA)
        val transport = TestServer.get("/api/v1/claims/eligible-types", nadia).jsonObject["items"]!!.jsonArray
            .map { it.jsonObject }.first { it["name"]!!.jsonPrimitive.content == "Transport" }["id"]!!.jsonPrimitive.content
        val claim = TestServer.post("/api/v1/claims", nadia, buildJsonObject {
            put("lines", buildJsonArray {
                add(buildJsonObject {
                    put("claimTypeId", transport); put("expenseDate", LocalDate.now(Formats.SINGAPORE).toString())
                    put("merchant", "ComfortDelGro"); put("description", "Taxi"); put("amountMinor", 1250)
                })
            })
        }).jsonObject
        val claimId = claim["id"]!!.jsonPrimitive.content
        try {
            val key = j.graph.connections.active()!!.key
            val target = RefreshLogic.Target("notifications", key, "/claims/$claimId", null, 1)
            j.context.startActivity(Notifications.openIntent(j.context, target))
            j.waitFor("claim-edit")
            j.waitForText("ComfortDelGro", substring = true)
            // Back goes to the claims list, then More.
            j.tap("back")
            j.waitFor("new-claim")
        } finally {
            TestServer.call("DELETE", "/api/v1/claims/$claimId", TestServer.token(TestServer.NADIA))
        }
    }

    @Test fun managersSeeHowManyApprovalsWait() {
        TestServer.requestLeaveAsNadia(TestServer.freeWeekday(10, offsetDays = (0..15).random().toLong()))
        j.connectAndSignIn(TestServer.KAIWEN)
        j.waitFor("badge-tasks", unmerged = true)
        compose.onNode(hasContentDescription("to approve", substring = true)).assertExists()
        val waiting = TestServer.get("/api/v1/approvals/tasks", TestServer.token(TestServer.KAIWEN)).jsonObject["items"]!!.jsonArray.size
        j.untilTexts("badge count") { texts -> texts.any { it.endsWith(", $waiting to approve") } }
    }
}
