package crowtech.crowhr

import android.content.Intent
import android.net.Uri
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isRoot
import androidx.test.espresso.Espresso
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import crowtech.crowhr.api.NetworkObserver
import crowtech.crowhr.auth.BrowserLauncher
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue

/**
 * What the journey tests share (the same steps as EssJourneyTest): a fresh app, sign-in through a
 * test browser, waiting and tapping by test tag, and the network allow-list check at the end.
 */
@OptIn(ExperimentalTestApi::class)
class Journey(private val compose: ComposeTestRule) {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    val graph = AppGraph.get(context)
    val camera = StubCamera()
    private val recorder = NetworkRecorder()
    var scenario: ActivityScenario<MainActivity>? = null

    fun setUp() {
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, crowtech.crowhr.connect.LocalNetwork.PERMISSION)
        graph.resetForTests()
        graph.receiptCamera = camera
        NetworkObserver.sink = recorder::record
    }

    /** Network allow-list: the app talked to the test server and nothing else. */
    fun tearDown() {
        scenario?.close()
        NetworkObserver.sink = null
        if (scenario == null) return
        assertTrue("the app made no requests", recorder.hosts.isNotEmpty())
        assertEquals("hosts contacted", setOf(TestServer.host), recorder.hosts.toSet())
        assertTrue("socket addresses", recorder.addresses.all { it == TestServer.host })
    }

    /** [unmerged]: a tag inside a merged item (a tab's label). */
    fun waitFor(tag: String, timeout: Long = 20_000, unmerged: Boolean = false) =
        runCatching { compose.waitUntil(timeout) { compose.onAllNodesWithTag(tag, useUnmergedTree = unmerged).fetchSemanticsNodes().isNotEmpty() } }
            .getOrElse { throw AssertionError("no \"$tag\" on screen: ${screenTexts()}") }

    fun waitForText(text: String, timeout: Long = 20_000, substring: Boolean = true) =
        runCatching { compose.waitUntil(timeout) { compose.onAllNodesWithText(text, substring = substring).fetchSemanticsNodes().isNotEmpty() } }
            .getOrElse { throw AssertionError("no \"$text\" on screen: ${screenTexts()}") }

    fun waitUntilGone(tag: String, timeout: Long = 20_000) =
        compose.waitUntil(timeout) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isEmpty() }

    /** Scrolls the node into view when it lives in a scrolling column (tabs don't), then taps. */
    fun tap(tag: String): SemanticsNodeInteraction {
        val node = compose.onNodeWithTag(tag)
        runCatching { node.performScrollTo() }
        return node.performClick()
    }

    fun has(tag: String) = compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty()

    /**
     * Opens the dropdown [tag] and chooses the item that reads exactly [text]. The keyboard of the
     * field before is closed first; a tap it swallowed is tried again.
     */
    fun pick(tag: String, text: String) {
        val item = hasText(text) and !hasTestTag(tag)
        repeat(3) {
            runCatching { Espresso.closeSoftKeyboard() }
            tap(tag)
            val shown = runCatching { compose.waitUntil(5_000) { compose.onAllNodes(item).fetchSemanticsNodes().isNotEmpty() } }.isSuccess
            if (shown) {
                compose.onNode(item).performClick()
                return
            }
        }
        throw AssertionError("\"$text\" not offered by $tag; on screen: ${screenTexts()}")
    }

    /** The text of the node tagged [tag]. */
    fun textOf(tag: String): String =
        compose.onNodeWithTag(tag).fetchSemanticsNode().config[SemanticsProperties.Text].joinToString("") { it.text }

    /** Every text on screen, for failure messages and checks. */
    fun screenTexts(): List<String> = compose.onAllNodes(isRoot()).fetchSemanticsNodes().flatMap { collect(it) }

    private fun collect(node: SemanticsNode): List<String> =
        (node.config.getOrElseNullable(SemanticsProperties.Text) { null }?.map { it.text } ?: emptyList()) +
            listOfNotNull(node.config.getOrElseNullable(SemanticsProperties.EditableText) { null }?.text) +
            (node.config.getOrElseNullable(SemanticsProperties.ContentDescription) { null } ?: emptyList()) +
            node.children.flatMap { collect(it) }

    fun untilTexts(what: String, timeout: Long = 20_000, ok: (List<String>) -> Boolean) {
        runCatching { compose.waitUntil(timeout) { ok(screenTexts()) } }
            .onFailure { throw AssertionError("$what; on screen: ${screenTexts()}") }
    }

    /** Opens [link] (a QR code or the try page's link), confirms the organisation and signs in through [browser]. */
    fun connectAndSignIn(link: String, browser: BrowserLauncher) {
        graph.browser = browser
        scenario = ActivityScenario.launch(Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(context.packageName))
        waitFor("confirm-connect")
        tap("confirm-connect")
        waitFor("sign-in")
        tap("sign-in")
        // Generous: a busy shared host can take a while to finish the sign-in.
        waitFor("tab-more", 60_000)
    }

    fun connectAndSignIn(email: String) = connectAndSignIn(TestServer.connectLink, TestBrowser(email))
}
