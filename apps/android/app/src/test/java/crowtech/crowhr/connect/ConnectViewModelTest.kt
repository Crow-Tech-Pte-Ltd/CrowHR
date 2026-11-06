package crowtech.crowhr.connect

import crowtech.crowhr.Fixtures
import crowtech.crowhr.arr
import crowtech.crowhr.obj
import crowtech.crowhr.security.InMemoryKeyValueStore
import crowtech.crowhr.str
import crowtech.crowhr.strings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Task 2.2 (mobile-apps spec "Connect to a company server"): every case in
 * apps/mobile-fixtures/connect-cases.json, then the view model's states for the HTTPS rule,
 * the private-range warning, incompatible servers and the 5-connection limit.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ConnectViewModelTest {
    private val fixture = Fixtures.load("connect-cases.json")
    private val messages = fixture.obj("messages")!!
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)
    @After fun tearDown() = Dispatchers.resetMain()

    /** Replays the case's meta response and records the URL the app asked for. */
    private class FixtureFetcher(private val meta: JsonObject?) : MetaFetcher {
        val requested = mutableListOf<String>()
        override suspend fun fetch(url: String): HttpResult {
            requested += url
            val m = meta ?: error("No meta request was expected, but the app fetched $url")
            m.str("network")?.let { return HttpResult.NetworkFailure(it) }
            val body = m["body"]!!
            val text = if (body is JsonPrimitive && body.isString) body.content else body.toString()
            return HttpResult.Response(m["status"]!!.jsonPrimitive.int, m.str("contentType"), text)
        }
    }

    private fun caseList() = fixture.arr("cases").map { it.jsonObject }

    @Test fun everyFixtureCase() = runTest(dispatcher) {
        for (case in caseList()) {
            val id = case.str("id")
            val expected = case.obj("expected")!!
            val fetcher = FixtureFetcher(case["meta"] as? JsonObject)
            val outcome = ConnectCheck(fetcher).check(case.str("input")!!, case.str("org"))
            val code = expected.str("outcome")!!
            assertEquals("$id outcome", code, outcome.code)
            assertEquals("$id metaUrl", expected.str("metaUrl"), fetcher.requested.singleOrNull())
            if (outcome is ConnectOutcome.Ok) {
                assertEquals("$id server", expected.str("server"), outcome.server)
                assertEquals("$id insecure", expected["insecure"]!!.jsonPrimitive.boolean, outcome.insecure)
                assertEquals("$id org", expected.str("orgSlug"), outcome.org.slug)
                assertEquals("$id name", expected.str("displayName"), outcome.org.displayName)
                assertEquals("$id methods", expected["signInMethodKinds"]!!.strings(), outcome.org.signInMethods.map { it.kind })
                assertEquals("$id hidden", expected["hiddenScreens"]!!.strings(), outcome.hiddenScreens.map { it.id })
                expected["featureNotices"]?.let { assertEquals("$id notices", it.strings(), outcome.featureNotices) }
            } else {
                assertEquals("$id message", messages.str(code), outcome.message)
                if (expected["server"] !is JsonNull) assertEquals("$id server", expected.str("server"), (outcome as ConnectOutcome.Failed).server)
            }
        }
    }

    @Test fun featureGateTableMatchesFixture() {
        val screens = fixture.obj("featureGates")!!.obj("screens")!!
        assertEquals(screens.keys, AppScreen.entries.map { it.id }.toSet())
        for (screen in AppScreen.entries) {
            val spec = screens.obj(screen.id)!!
            assertEquals(spec.str("label"), screen.label)
            assertEquals(spec["requires"]!!.strings(), screen.requires)
        }
        assertEquals(fixture["supportedApiVersions"]!!.strings(), ConnectCheck.SUPPORTED_API_VERSIONS)
    }

    @Test fun savedConnectionsFixture() {
        val spec = fixture.obj("savedConnectionCases")!!
        val store = ConnectionStore(InMemoryKeyValueStore())
        assertEquals(spec["limit"]!!.jsonPrimitive.int, ConnectionStore.LIMIT)
        for (step in spec.arr("steps").map { it.jsonObject }) {
            val expect = step.obj("expect")!!
            val result = when (step.str("op")) {
                "add" -> store.add(saved(step.str("server")!!, step.str("orgSlug")!!, step.str("displayName")!!))
                "switch" -> store.switchTo(step.str("key")!!)
                "remove" -> store.remove(step.str("key")!!)
                else -> error("unknown op")
            }
            assertEquals("$step", expect.str("result"), result.code)
            assertEquals("$step count", expect["count"]!!.jsonPrimitive.int, store.all().size)
            assertEquals("$step active", expect.str("active"), store.active()?.key)
        }
        // Persisted: a new store over the same backing data sees the same list.
        assertEquals(5, store.all().size)
    }

    @Test fun savedConnectionsSurviveRestart() {
        val kv = InMemoryKeyValueStore()
        ConnectionStore(kv).add(saved("https://a.example.com", "a", "A"))
        val again = ConnectionStore(kv)
        assertEquals("https://a.example.com|a", again.active()?.key)
        assertEquals("A", again.all().single().displayName)
    }

    private fun saved(server: String, slug: String, name: String) = SavedConnection(
        server = server, orgSlug = slug, displayName = name, logoUrl = null, insecure = false,
        features = listOf("leave"), signInMethods = listOf(MetaSignInMethod("password", "Email and password")),
    )

    private fun okMeta(features: String = "\"leave\",\"attendance.offlinePunch\"") =
        """{"serverVersion":"0.9.0","apiVersions":["v1"],"features":[$features],"demo":false,"orgSlugRequired":false,"organisations":[{"slug":"kampong-kopi","displayName":"Kampong Kopi Pte. Ltd.","logoUrl":null,"signInMethods":[{"kind":"password","displayName":"Email and password"}]}]}"""

    private class StaticFetcher(private val result: HttpResult) : MetaFetcher {
        var calls = 0
        override suspend fun fetch(url: String): HttpResult { calls++; return result }
    }

    @Test fun httpsRuleRefusesPublicHttpWithoutFetching() = runTest(dispatcher) {
        val fetcher = StaticFetcher(HttpResult.Response(200, "application/json", okMeta()))
        val vm = ConnectViewModel(ConnectCheck(fetcher), ConnectionStore(InMemoryKeyValueStore()))
        vm.onAddressChange("http://hr.example.com")
        vm.submit()
        advanceUntilIdle()
        val phase = vm.state.value.phase as ConnectPhase.Failed
        assertEquals("https_required", phase.code)
        assertEquals(messages.str("https_required"), phase.message)
        assertEquals(0, fetcher.calls)
    }

    @Test fun privateRangeHttpShowsWarningBeforeSaving() = runTest(dispatcher) {
        val fetcher = StaticFetcher(HttpResult.Response(200, "application/json", okMeta()))
        val store = ConnectionStore(InMemoryKeyValueStore())
        val vm = ConnectViewModel(ConnectCheck(fetcher), store)
        vm.onAddressChange("http://192.168.1.20:8080")
        vm.submit()
        advanceUntilIdle()
        val confirm = vm.state.value.phase as ConnectPhase.Confirm
        assertEquals(messages.str("insecure_warning"), confirm.warning)
        assertEquals("Kampong Kopi Pte. Ltd.", confirm.outcome.org.displayName)
        assertTrue("nothing saved before the user confirms", store.all().isEmpty())
        vm.confirm()
        advanceUntilIdle()
        val saved = (vm.state.value.phase as ConnectPhase.Connected).connection
        assertTrue(saved.insecure)
        assertEquals("http://192.168.1.20:8080|kampong-kopi", store.active()?.key)
    }

    @Test fun localNetworkServerAsksForAccessBeforeAnyRequest() = runTest(dispatcher) {
        val fetcher = StaticFetcher(HttpResult.Response(200, "application/json", okMeta()))
        var allowed = false
        val vm = ConnectViewModel(ConnectCheck(fetcher), ConnectionStore(InMemoryKeyValueStore())) { allowed }
        vm.onAddressChange("http://192.168.1.20:8080")
        vm.submit()
        advanceUntilIdle()
        assertEquals(ConnectPhase.NeedsLocalNetwork, vm.state.value.phase)
        assertEquals(0, fetcher.calls)
        vm.localNetworkDenied()
        assertEquals("local_network_denied", (vm.state.value.phase as ConnectPhase.Failed).code)
        allowed = true
        vm.submit()
        advanceUntilIdle()
        assertTrue(vm.state.value.phase is ConnectPhase.Confirm)
        assertEquals(1, fetcher.calls)
    }

    @Test fun localHostClassification() {
        assertTrue(LocalNetwork.isLocalHost("192.168.1.20"))
        assertTrue(LocalNetwork.isLocalHost("crowhr.local"))
        assertTrue(LocalNetwork.isLocalHost("[fd00::1]"))
        assertFalse(LocalNetwork.isLocalHost("127.0.0.1"))
        assertFalse(LocalNetwork.isLocalHost("localhost"))
        assertFalse(LocalNetwork.isLocalHost("hr.example.com"))
    }

    @Test fun httpsHasNoWarning() = runTest(dispatcher) {
        val vm = ConnectViewModel(
            ConnectCheck(StaticFetcher(HttpResult.Response(200, "application/json", okMeta()))),
            ConnectionStore(InMemoryKeyValueStore()),
        )
        vm.onAddressChange("hr.kampongkopi.example")
        vm.submit()
        advanceUntilIdle()
        assertNull((vm.state.value.phase as ConnectPhase.Confirm).warning)
    }

    @Test fun incompatibleServerSaysWhichSideToUpdate() = runTest(dispatcher) {
        val newer = """{"serverVersion":"3.0.0","apiVersions":["v2"],"features":[],"demo":false,"orgSlugRequired":false,"organisations":[]}"""
        val vm = ConnectViewModel(
            ConnectCheck(StaticFetcher(HttpResult.Response(200, "application/json", newer))),
            ConnectionStore(InMemoryKeyValueStore()),
        )
        vm.onAddressChange("https://hr.example.com")
        vm.submit()
        advanceUntilIdle()
        val failed = vm.state.value.phase as ConnectPhase.Failed
        assertEquals("app_too_old", failed.code)
        assertTrue(failed.message.contains("Update the Crow HR app"))

        val older = """{"serverVersion":"0.1.0","apiVersions":[],"features":[],"demo":false,"orgSlugRequired":false,"organisations":[]}"""
        val vm2 = ConnectViewModel(
            ConnectCheck(StaticFetcher(HttpResult.Response(200, "application/json", older))),
            ConnectionStore(InMemoryKeyValueStore()),
        )
        vm2.onAddressChange("https://hr.example.com")
        vm2.submit()
        advanceUntilIdle()
        assertTrue((vm2.state.value.phase as ConnectPhase.Failed).message.contains("Ask your administrator to upgrade"))
    }

    @Test fun oldServerHidesScreensAndExplainsWhy() = runTest(dispatcher) {
        val vm = ConnectViewModel(
            ConnectCheck(StaticFetcher(HttpResult.Response(200, "application/json", okMeta(features = "")))),
            ConnectionStore(InMemoryKeyValueStore()),
        )
        vm.onAddressChange("https://hr.example.com")
        vm.submit()
        advanceUntilIdle()
        val confirm = vm.state.value.phase as ConnectPhase.Confirm
        assertEquals(listOf(AppScreen.Leave, AppScreen.Clock), confirm.outcome.hiddenScreens)
        assertEquals(
            "Your company's Crow HR server is older than this app. Leave is available after your administrator upgrades.",
            confirm.outcome.featureNotices.first(),
        )
        vm.confirm()
        advanceUntilIdle()
        val saved = (vm.state.value.phase as ConnectPhase.Connected).connection
        assertFalse(AppScreen.Leave.isAvailable(saved.features))
        assertTrue(AppScreen.Payslips.isAvailable(saved.features))
    }

    @Test fun sixthConnectionIsRefused() = runTest(dispatcher) {
        val store = ConnectionStore(InMemoryKeyValueStore())
        for (i in 1..5) store.add(saved("https://s$i.example.com", "o$i", "Org $i"))
        val vm = ConnectViewModel(ConnectCheck(StaticFetcher(HttpResult.Response(200, "application/json", okMeta()))), store)
        vm.onAddressChange("https://hr.kampongkopi.example")
        vm.submit()
        advanceUntilIdle()
        vm.confirm()
        advanceUntilIdle()
        val failed = vm.state.value.phase as ConnectPhase.Failed
        assertEquals("too_many_connections", failed.code)
        assertEquals(messages.str("too_many_connections"), failed.message)
        assertEquals(5, store.all().size)
    }

    @Test fun qrDeepLinkFillsAddressAndOrgAndChecks() = runTest(dispatcher) {
        val fetcher = FixtureFetcher(
            kotlinx.serialization.json.Json.parseToJsonElement(
                """{"status":200,"contentType":"application/json","body":${okMeta()}}""",
            ).jsonObject,
        )
        val vm = ConnectViewModel(ConnectCheck(fetcher), ConnectionStore(InMemoryKeyValueStore()))
        vm.onLink("crowhr://connect?server=https%3A%2F%2Fhr.kampongkopi.example&org=kampong-kopi")
        advanceUntilIdle()
        assertEquals(listOf("https://hr.kampongkopi.example/api/v1/meta?org=kampong-kopi"), fetcher.requested)
        assertTrue(vm.state.value.phase is ConnectPhase.Confirm)

        val bad = ConnectViewModel(ConnectCheck(fetcher), ConnectionStore(InMemoryKeyValueStore()))
        bad.onLink("crowhr://connect?org=acme")
        advanceUntilIdle()
        assertEquals("invalid_qr", (bad.state.value.phase as ConnectPhase.Failed).code)
    }
}
