package crowtech.crowhr

import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream

/**
 * Task 2.7: real screenshots of the running app (not mock-ups) for design QA, in the variant
 * named by the `crowhrShots` argument: phone, large (200% font), dark, large-dark. Payslip
 * screens use FLAG_SECURE, so Android captures them as black: that is the expected result.
 * Saved to the app's external files dir; scripts/android-qa.sh pulls them to artifacts/android/.
 */
@RunWith(AndroidJUnit4::class)
class QaScreenshotTest {
    @get:Rule val compose: ComposeTestRule = createEmptyComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val graph = AppGraph.get(context)
    private val variant: String? = InstrumentationRegistry.getArguments().getString("crowhrShots")

    private fun shell(command: String) = instrumentation.uiAutomation.executeShellCommand(command).close()

    private fun waitFor(tag: String, timeout: Long = 20_000) =
        compose.waitUntil(timeout) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }

    private fun tap(tag: String) = compose.onNodeWithTag(tag).let { node ->
        runCatching { node.performScrollTo() }
        node.performClick()
    }

    private var index = 0
    private fun shot(name: String) {
        compose.waitForIdle()
        Thread.sleep(700)
        val bitmap: Bitmap = instrumentation.uiAutomation.takeScreenshot() ?: return
        val dir = File(context.getExternalFilesDir("qa"), variant!!).apply { mkdirs() }
        FileOutputStream(File(dir, "%02d-%s.png".format(++index, name))).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test fun capture() {
        assumeTrue("pass -e crowhrShots <variant> to capture", variant != null)
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, crowtech.crowhr.connect.LocalNetwork.PERMISSION)
        val large = variant!!.contains("large")
        val dark = variant.contains("dark")
        shell("settings put system font_scale ${if (large) "2.0" else "1.0"}")
        shell("cmd uimode night ${if (dark) "yes" else "no"}")
        Thread.sleep(1_500)
        try {
            run()
        } finally {
            shell("settings put system font_scale 1.0")
            shell("cmd uimode night no")
        }
    }

    private fun run() {
        TestServer.ensureReleasedPayslip()
        TestServer.ensurePublishedShift()
        val taskTitle = runCatching { TestServer.requestLeaveAsNadia(TestServer.freeWeekday(8, offsetDays = (0..20).random().toLong())) }.getOrNull()
        graph.resetForTests()
        graph.receiptCamera = StubCamera()
        graph.browser = TestBrowser(TestServer.KAIWEN)

        ActivityScenario.launch(MainActivity::class.java).use {
            waitFor("scan-qr")
            shot("connect")
        }
        val scenario = ActivityScenario.launch<MainActivity>(
            Intent(Intent.ACTION_VIEW, Uri.parse(TestServer.connectLink)).setPackage(context.packageName),
        )
        waitFor("confirm-connect")
        shot("connect-confirm-insecure")
        tap("confirm-connect")
        waitFor("sign-in")
        shot("sign-in")
        tap("sign-in")
        waitFor("tab-more", 30_000)
        waitFor("clock-button")
        Thread.sleep(1_500)
        shot("clock")
        tap("tab-leave")
        compose.waitUntil(20_000) { compose.onAllNodes(hasText("Annual leave")).fetchSemanticsNodes().isNotEmpty() }
        shot("leave")
        tap("apply-leave")
        waitFor("leave-type")
        shot("leave-apply")
        tap("back")
        tap("tab-pay")
        Thread.sleep(2_000)
        shot("payslips-flag-secure")
        tap("tab-tasks")
        Thread.sleep(2_500)
        shot("approvals")
        taskTitle?.let { title ->
            compose.onNode(hasText(title)).also { runCatching { it.performScrollTo() } }.performClick()
            waitFor("reject")
            tap("reject")
            Thread.sleep(800)
            shot("approval-comment-required")
        }
        tap("tab-more")
        shot("more")
        tap("more-claims")
        waitFor("new-claim")
        tap("new-claim")
        waitFor("claim-type-0")
        shot("claim-new")
        tap("back")
        tap("back")
        tap("more-schedule")
        Thread.sleep(2_000)
        shot("schedule")
        tap("back")
        tap("more-notifications")
        Thread.sleep(2_000)
        shot("notifications")
        tap("back")
        tap("more-settings")
        waitFor("sign-out")
        shot("settings")
        scenario.close()
    }
}
