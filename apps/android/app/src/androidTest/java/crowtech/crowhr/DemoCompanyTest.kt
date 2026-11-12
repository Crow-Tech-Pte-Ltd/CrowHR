package crowtech.crowhr

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Demo companies (openspec add-demo-companies) against a test server started with
 * DEMO_COMPANIES=1: a visitor opens the try page's `crowhr://connect` link, or types the server
 * address and then the company code into the Organisation ID field, and signs in by picking a
 * person on the server's sign-in page (no password). Skipped when the server has no demo companies.
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class DemoCompanyTest {
    @get:Rule val compose: ComposeTestRule = createEmptyComposeRule()
    private val j = Journey(compose)

    companion object {
        /** One copy for the whole class: starts are rate limited per network. */
        private var company: JsonObject? = null
        fun company(): JsonObject = company ?: TestServer.startDemoCompany().also { company = it }
    }

    @Before fun setUp() {
        // First: it grants the local network access the server's address needs.
        j.setUp()
        assumeTrue("start the test server with DEMO_COMPANIES=1 to run these", TestServer.demoCompaniesOn())
    }

    @After fun tearDown() = j.tearDown()

    private val slug get() = company()["slug"]!!.jsonPrimitive.content

    private fun signedInAsHafiz(browser: PersonaBrowser) {
        j.waitFor("tab-more", 30_000)
        assertTrue(browser.opened.single().startsWith("${TestServer.base}/api/v1/native/authorize?org=$slug&client=android&"))
        assertEquals("${TestServer.base}|$slug", j.graph.connections.active()!!.key)
        j.tap("tab-more")
        j.waitFor("demo-company-notice")
        j.waitForText("deleted on", substring = true)
        j.tap("more-profile")
        j.waitForText("Hafiz", substring = true)
    }

    private fun confirmAndSignIn(browser: PersonaBrowser) {
        j.waitFor("confirm-connect")
        compose.onNodeWithText("Kopi Kaki", substring = true).assertExists()
        j.waitFor("demo-label")
        j.tap("confirm-connect")
        j.waitFor("sign-in")
        j.waitFor("demo-sign-in-note")
        compose.onNodeWithText("Pick a person (demo company, no password)").assertExists()
        j.tap("sign-in")
        signedInAsHafiz(browser)
    }

    @Test fun theTryPagesLinkOpensTheDemoCompany() {
        val link = company()["connectUrl"]!!.jsonPrimitive.content
        assertTrue(link, link.startsWith("crowhr://connect?server=") && link.endsWith("&org=$slug"))
        val browser = PersonaBrowser(slug, "employee")
        j.graph.browser = browser
        j.scenario = ActivityScenario.launch(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(link)).setPackage(j.context.packageName))
        confirmAndSignIn(browser)
    }

    @Test fun theAddressAndCompanyCodeTypedInTheOrganisationIdField() {
        val browser = PersonaBrowser(slug, "employee")
        j.graph.browser = browser
        j.scenario = ActivityScenario.launch(MainActivity::class.java)
        j.waitFor("server-address")
        assertTrue(compose.onAllNodesWithTag("organisation-id").fetchSemanticsNodes().isEmpty())
        compose.onNodeWithTag("server-address").performTextInput(TestServer.base)
        j.tap("check-address")
        // A server with demo companies always asks which organisation (and never lists them).
        j.waitFor("organisation-id")
        j.waitForText("for a demo company, its company code", substring = true)
        // As the visitor copies it from the try page: upper-case and a stray space are fine.
        compose.onNodeWithTag("organisation-id").performTextInput(" ${slug.uppercase()} ")
        j.tap("check-address")
        confirmAndSignIn(browser)
    }

    @Test fun anUnknownCompanyCodeSaysSo() {
        j.scenario = ActivityScenario.launch(MainActivity::class.java)
        j.waitFor("server-address")
        compose.onNodeWithTag("server-address").performTextInput(TestServer.base)
        j.tap("check-address")
        j.waitFor("organisation-id")
        compose.onNodeWithTag("organisation-id").performTextInput("demo-zzzzzzzzzzzz")
        j.tap("check-address")
        j.waitForText("This server has no organisation with that code", substring = true)
    }
}
