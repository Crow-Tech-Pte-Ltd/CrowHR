package crowtech.crowhr

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.view.WindowManager
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import crowtech.crowhr.api.NetworkObserver
import crowtech.crowhr.core.Formats
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Task 2.5: the employee self-service and manager journeys in the real app against the local
 * seeded server (scripts/android-test-server.sh), with the network allow-list assertion
 * (mobile-apps spec "Network allow-list test": every connection goes to the test server's host).
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class EssJourneyTest {
    @get:Rule val compose: ComposeTestRule = createEmptyComposeRule()

    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val graph = AppGraph.get(context)
    private val recorder = NetworkRecorder()
    private val camera = StubCamera()
    private var scenario: ActivityScenario<MainActivity>? = null

    @Before fun setUp() {
        // The test server is at 10.0.2.2 (private range): Android 17 asks for local network
        // access, which the connect screen requests. The system dialog is granted here.
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, crowtech.crowhr.connect.LocalNetwork.PERMISSION)
        graph.resetForTests()
        graph.receiptCamera = camera
        NetworkObserver.sink = recorder::record
    }

    @After fun tearDown() {
        scenario?.close()
        NetworkObserver.sink = null
        shell("cmd connectivity airplane-mode disable")
        // Network allow-list: the app talked to the test server and nothing else.
        assertTrue("the app made no requests", recorder.hosts.isNotEmpty())
        assertEquals("hosts contacted", setOf(TestServer.host), recorder.hosts.toSet())
        assertTrue("socket addresses", recorder.addresses.all { it == TestServer.host })
    }

    private fun shell(command: String) {
        instrumentation.uiAutomation.executeShellCommand(command).close()
    }

    private fun waitFor(tag: String, timeout: Long = 20_000) =
        compose.waitUntil(timeout) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }

    private fun waitForText(text: String, timeout: Long = 20_000, substring: Boolean = true) =
        compose.waitUntil(timeout) { compose.onAllNodesWithText(text, substring = substring).fetchSemanticsNodes().isNotEmpty() }

    private fun tap(tag: String): SemanticsNodeInteraction = compose.onNodeWithTag(tag).performScrollTo().performClick()

    private fun currentActivity(): Activity? {
        var found: Activity? = null
        instrumentation.runOnMainSync {
            found = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).firstOrNull()
        }
        return found
    }

    /** Scan the QR link, confirm the organisation, sign in through the (test) browser. */
    private fun connectAndSignIn(email: String) {
        val browser = TestBrowser(email)
        graph.browser = browser
        scenario = ActivityScenario.launch(
            Intent(Intent.ACTION_VIEW, Uri.parse(TestServer.connectLink)).setPackage(context.packageName),
        )
        waitFor("confirm-connect")
        compose.onNodeWithText("Kampong Kopi Pte. Ltd.").assertExists()
        compose.onNodeWithText("This connection is not encrypted", substring = true).assertExists()
        tap("confirm-connect")
        waitFor("sign-in")
        tap("sign-in")
        waitFor("tab-more", 30_000)
        val url = browser.opened.single()
        assertTrue(url.startsWith("${TestServer.base}/api/v1/native/authorize?org=kampong-kopi&client=android&redirect_uri=crowtech.crowhr%3A%2Foauth2redirect"))
        assertTrue(url.contains("code_challenge_method=S256"))
        assertNotNull(graph.tokens.get(graph.connections.active()!!.key))
    }

    @Test fun payslipsListDetailAndPdfOnRequest() {
        val payslip = TestServer.ensureReleasedPayslip()
        connectAndSignIn(TestServer.NADIA)
        tap("tab-pay")
        val id = payslip["id"]!!.jsonPrimitive.content
        waitFor("payslip-$id")
        val net = Formats.money(payslip["netPayableCents"]!!.jsonPrimitive.long)
        compose.onAllNodesWithText(net).fetchSemanticsNodes().isNotEmpty().let(::assertTrue)
        assertTrue("payslip screens set FLAG_SECURE", secure())
        tap("payslip-$id")
        waitFor("net-pay")
        compose.onNodeWithTag("net-pay").assertExists()
        compose.onNodeWithText("Gross pay").assertExists()
        assertTrue(secure())
        // The PDF is fetched only on request, shown, and not kept.
        val share = File(context.cacheDir, "share")
        assertFalse(share.exists() && share.listFiles()!!.isNotEmpty())
        tap("download-pdf")
        compose.waitUntil(20_000) { share.listFiles()?.any { it.length() > 0 } == true }
        val pdf = share.listFiles()!!.first()
        assertEquals("%PDF", pdf.readBytes().take(4).toByteArray().decodeToString())
        // The system chooser / PDF viewer is in front now; come back to the app.
        Thread.sleep(1_500)
        if (currentActivity() == null) {
            instrumentation.uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK)
        }
        compose.waitUntil(10_000) { currentActivity() is MainActivity }
        waitFor("back")
        tap("back")
        compose.waitUntil(10_000) { share.listFiles().isNullOrEmpty() }
        // Payslip details are never cached (only the list is, for offline).
        assertNull(graph.cache.get(graph.connections.active()!!.key, "payslip-$id", kotlinx.serialization.json.JsonElement.serializer()))
        tap("tab-clock")
        compose.waitUntil(5_000) { !secure() }
    }

    private fun secure(): Boolean {
        var flags = 0
        instrumentation.runOnMainSync { flags = currentActivity()?.window?.attributes?.flags ?: 0 }
        return flags and WindowManager.LayoutParams.FLAG_SECURE != 0
    }

    @Test fun leaveBalancesApplyAndHistory() {
        // The form starts on the next working day; free it from earlier runs of this test.
        TestServer.withdrawPendingLeave(crowtech.crowhr.ui.screens.nextWorkingDay(java.time.LocalDate.now(Formats.SINGAPORE)))
        connectAndSignIn(TestServer.NADIA)
        tap("tab-leave")
        waitForText("Annual leave")
        tap("apply-leave")
        waitFor("leave-type")
        tap("leave-type")
        compose.onNodeWithText("Annual leave").performClick()
        waitFor("leave-quote")
        assertTrue(compose.onAllNodesWithText("1 day").fetchSemanticsNodes().isNotEmpty())
        compose.onNodeWithTag("leave-reason").performScrollTo().performTextInput("Family day")
        tap("send-leave")
        waitFor("leave-done")
        compose.onNodeWithText("Request sent").assertExists()
        tap("leave-done")
        waitForText("Waiting for approval")
    }

    @Test fun claimWithCameraReceipt() {
        connectAndSignIn(TestServer.AHMAD)
        tap("tab-more")
        tap("more-claims")
        waitFor("new-claim")
        tap("new-claim")
        waitFor("claim-type-0")
        tap("claim-type-0")
        compose.onNodeWithText("Client entertainment").performClick()
        compose.onNodeWithTag("claim-merchant-0").performScrollTo().performTextInput("Kopitiam Bugis")
        compose.onNodeWithTag("claim-amount-0").performScrollTo().performTextInput("45.80")
        // Submitting without the required receipt explains how to fix it.
        tap("submit-claim")
        waitForText("Add a photo of the receipt.")
        tap("receipt-0")
        waitFor("receipt-attached")
        assertEquals(1, camera.shots)
        tap("submit-claim")
        waitFor("claim-done")
        compose.onNodeWithText("S$45.80", substring = true).assertExists()
        tap("claim-done")
        waitForText("Waiting for approval")
        assertTrue("the photo was deleted after upload", File(context.cacheDir, "receipts").listFiles().isNullOrEmpty())
    }

    @Test fun publishedSchedule() {
        val monday = TestServer.ensurePublishedShift()
        connectAndSignIn(TestServer.NURUL)
        tap("tab-more")
        tap("more-schedule")
        waitFor("shift-$monday")
        compose.onNodeWithText("09:00–17:00").assertExists()
        compose.onNodeWithText("60 min break", substring = true).assertExists()
    }

    @Test fun managerRejectsWithCommentAndApproves() {
        val rejectTitle = TestServer.requestLeaveAsNadia(TestServer.freeWeekday(5))
        val approveTitle = TestServer.requestLeaveAsNadia(TestServer.freeWeekday(6))
        connectAndSignIn(TestServer.KAIWEN)
        tap("tab-tasks")
        waitForText(rejectTitle)
        compose.onNode(hasText(rejectTitle)).performScrollTo().performClick()
        waitFor("reject")
        // Spec "Manager approves on phone": rejecting without a comment asks for one first.
        tap("reject")
        waitForText("Add a comment so Nadia Rahman knows why it was rejected.")
        compose.onNodeWithTag("decision-comment").performScrollTo().performTextInput("We are short-staffed that week, sorry.")
        tap("reject")
        waitForText("Rejected: $rejectTitle")
        compose.onNode(hasText(approveTitle)).performScrollTo().performClick()
        waitFor("approve")
        tap("approve")
        waitForText("Approved: $approveTitle")
        compose.waitUntil(15_000) { compose.onAllNodes(hasText(approveTitle) and !hasText("Approved: ", substring = true)).fetchSemanticsNodes().isEmpty() }
    }

    @Test fun notificationsInbox() {
        connectAndSignIn(TestServer.NADIA)
        tap("tab-more")
        tap("more-notifications")
        waitForText("Your leave request was approved")
        compose.onAllNodesWithTag("notification-row").fetchSemanticsNodes().isNotEmpty().let(::assertTrue)
        compose.onNodeWithText("Mark all as read").performScrollTo().performClick()
        compose.waitUntil(15_000) { compose.onAllNodesWithText("Mark all as read").fetchSemanticsNodes().isEmpty() }
    }

    @Test fun clockInOfflineIsQueuedThenSynced() {
        connectAndSignIn(TestServer.AHMAD)
        waitFor("clock-button")
        waitForText("Not clocked in")
        shell("cmd connectivity airplane-mode enable")
        Thread.sleep(2_000)
        tap("clock-button")
        waitForText("Saved on this phone", 30_000)
        compose.onNodeWithText("Not sent yet. The app will retry automatically.").assertExists()
        val queued = graph.punchQueue(graph.connections.active()!!).pending().single()
        shell("cmd connectivity airplane-mode disable")
        val queue = graph.punchQueue(graph.connections.active()!!)
        for (i in 1..15) {
            if (queue.pending().isEmpty()) break
            Thread.sleep(2_000)
            runCatching { compose.onNodeWithText("Send now").performScrollTo().performClick() }
        }
        assertTrue("the queued punch was sent", queue.pending().isEmpty())
        val sent = graph.punchQueue(graph.connections.active()!!).find(queued.key)!!
        assertTrue(sent.state == "synced" || sent.state == "flagged")
        assertTrue("one key, retried", sent.attempts >= 2)
        waitForText("Clocked in")
    }

    @Test fun signOutDeletesLocalData() {
        connectAndSignIn(TestServer.NADIA)
        val key = graph.connections.active()!!.key
        tap("tab-more")
        tap("more-settings")
        waitFor("sign-out")
        tap("sign-out")
        tap("confirm-sign-out")
        waitFor("sign-in")
        compose.onNodeWithText("You're signed out", substring = true).assertExists()
        assertNull(graph.tokens.get(key))
        assertTrue(graph.store.keys().none { it.startsWith("cache.$key") || it.startsWith("tokens.") })
    }

    @Test fun revokedOnTheWebReturnsToSignIn() {
        connectAndSignIn(TestServer.NADIA)
        val key = graph.connections.active()!!.key
        val device = graph.tokens.get(key)!!.deviceSessionId
        // "Lost phone": the employee revokes this device from My sessions on the web.
        TestServer.call("DELETE", "/api/v1/me/sessions/$device", TestServer.token(TestServer.NADIA)).let { assertTrue("${it.status}", it.status in 200..299) }
        tap("tab-leave")
        waitFor("sign-in", 30_000)
        compose.onNodeWithText("Your session has ended", substring = true).assertExists()
        assertNull(graph.tokens.get(key))
    }

    @Suppress("unused")
    private fun all(tag: String) = compose.onAllNodes(hasTestTag(tag))
}
