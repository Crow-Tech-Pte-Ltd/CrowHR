package crowtech.crowhr.auth

import crowtech.crowhr.Fixtures
import crowtech.crowhr.api.ApiClient
import crowtech.crowhr.api.ApiException
import crowtech.crowhr.api.UnreadCount
import crowtech.crowhr.connect.MetaSignInMethod
import crowtech.crowhr.connect.SavedConnection
import crowtech.crowhr.obj
import crowtech.crowhr.security.AesGcmCrypter
import crowtech.crowhr.security.EncryptedFileStore
import crowtech.crowhr.str
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files
import javax.crypto.KeyGenerator
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Task 2.3 (mobile-apps spec "Native sign-in and session storage"; api-platform "Native client
 * authorisation"): PKCE pair, state check, encrypted token storage, backup exclusion rules,
 * token refresh and session end. The Keystore half of storage is in the instrumented
 * KeystoreStorageTest.
 */
class NativeAuthTest {
    private val fixture = Fixtures.load("deeplink-cases.json")
    private lateinit var server: MockWebServer
    private lateinit var dir: File
    private lateinit var store: EncryptedFileStore
    private lateinit var tokens: TokenStore
    private lateinit var auth: NativeAuth
    private lateinit var connection: SavedConnection
    private val http = OkHttpClient()

    @Before fun setUp() {
        server = MockWebServer().also { it.start() }
        dir = Files.createTempDirectory("crowhr-store").toFile()
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        store = EncryptedFileStore(dir, AesGcmCrypter { key })
        tokens = TokenStore(store)
        connection = SavedConnection(
            server = server.url("/").toString().trimEnd('/'),
            orgSlug = "kampong-kopi",
            displayName = "Kampong Kopi Pte. Ltd.",
            insecure = true,
            signInMethods = listOf(MetaSignInMethod("password", "Email and password")),
        )
        auth = NativeAuth(store, tokens, httpFor = { http }, deviceName = "Pixel 9 (Android)", appVersion = "0.1.0")
    }

    @After fun tearDown() {
        server.shutdown()
        dir.deleteRecursively()
    }

    @Test fun pkceVectorFromRfc7636() {
        val v = fixture.obj("pkce")!!["vectors"]!!.let { it as kotlinx.serialization.json.JsonArray }.first().jsonObject
        assertEquals(v.str("challenge"), Pkce.challengeFor(v.str("verifier")!!))
    }

    @Test fun generatedPkcePairsAndStatesAreWellFormedAndUnique() {
        val seen = mutableSetOf<String>()
        repeat(50) {
            val pair = Pkce.generate()
            assertTrue(pair.verifier.matches(Regex("^[A-Za-z0-9._~-]{43,128}$")))
            assertEquals(43, pair.verifier.length)
            assertEquals(Pkce.challengeFor(pair.verifier), pair.challenge)
            assertTrue(pair.challenge.matches(Regex("^[A-Za-z0-9_-]{43}$")))
            val state = Pkce.newState()
            assertTrue(state.length in 22..200)
            assertTrue(seen.add(pair.verifier) && seen.add(state))
        }
    }

    @Test fun authorizeUrlMatchesFixture() {
        val a = fixture.obj("pkce")!!.obj("authorizeUrl")!!
        val url = NativeAuth.authorizeUrl(
            server = a.str("server")!!, org = a.str("org")!!, client = a.str("client")!!,
            redirectUri = a.str("redirectUri")!!, challenge = a.str("challenge")!!, state = a.str("state")!!,
        )
        assertEquals(a.str("expected"), url)
        assertEquals("crowtech.crowhr:/oauth2redirect", NativeAuth.REDIRECT_URI)
    }

    @Test fun beginStoresVerifierAndStateForTheCallback() {
        val url = auth.begin(connection)
        val pending = auth.pending()!!
        assertTrue(url.startsWith("${connection.server}/api/v1/native/authorize?org=kampong-kopi&client=android&"))
        assertTrue(url.contains("code_challenge=${Pkce.challengeFor(pending.verifier)}"))
        assertTrue(url.contains("&state=${pending.state}"))
        assertFalse("the verifier never leaves the device", url.contains(pending.verifier))
        assertEquals(connection.key, pending.connectionKey)
    }

    @Test fun wrongStateIsRejectedAndNoCodeIsExchanged() = runTest {
        auth.begin(connection)
        val result = auth.complete("crowtech.crowhr:/oauth2redirect?code=stolen&state=attacker") { connection }
        assertTrue(result is SignInResult.Failed)
        assertEquals(0, server.requestCount)
        assertNull(tokens.get(connection.key))
        assertTrue("the real sign-in can still finish", auth.pending() != null)
    }

    @Test fun callbackWithoutPendingSignInIsRejected() = runTest {
        val result = auth.complete("crowtech.crowhr:/oauth2redirect?code=abc&state=whatever") { connection }
        assertTrue(result is SignInResult.Failed)
        assertEquals(0, server.requestCount)
    }

    @Test fun codeExchangeStoresTokensEncryptedAndStateIsSingleUse() = runTest {
        val access = "AT-plaintext-access-token-0123456789abcdef"
        val refresh = "RT-plaintext-refresh-token-0123456789abcdef"
        server.enqueue(tokenResponse(access, refresh))
        auth.begin(connection)
        val pending = auth.pending()!!
        val callback = "crowtech.crowhr:/oauth2redirect?code=one-time-code&state=${pending.state}"
        val result = auth.complete(callback) { connection }
        assertEquals(SignInResult.Success(connection.key), result)

        val request = server.takeRequest()
        assertEquals("/api/v1/native/token", request.path)
        val body = Json.parseToJsonElement(request.body.readUtf8()).jsonObject
        assertEquals("authorization_code", body["grantType"]!!.jsonPrimitive.content)
        assertEquals("one-time-code", body["code"]!!.jsonPrimitive.content)
        assertEquals(pending.verifier, body["codeVerifier"]!!.jsonPrimitive.content)
        assertEquals("Pixel 9 (Android)", body["deviceName"]!!.jsonPrimitive.content)

        assertEquals(access, tokens.get(connection.key)!!.accessToken)
        // On disk, nothing is readable: no token, no server address.
        val raw = dir.walk().filter { it.isFile }.map { it.readBytes().toString(Charsets.ISO_8859_1) }.joinToString("\n")
        assertFalse(raw.contains(access))
        assertFalse(raw.contains(refresh))
        assertFalse(raw.contains("Bearer"))

        // The state is single-use: replaying the same callback does nothing.
        assertTrue(auth.complete(callback) { connection } is SignInResult.Failed)
        assertEquals(1, server.requestCount)
    }

    @Test fun errorCallbackEndsThePendingSignIn() = runTest {
        auth.begin(connection)
        val state = auth.pending()!!.state
        val result = auth.complete("crowtech.crowhr:/oauth2redirect?error=access_denied&state=$state") { connection }
        assertTrue(result is SignInResult.Failed)
        assertNull(auth.pending())
        assertEquals(0, server.requestCount)
    }

    @Test fun serverRefusalIsShown() = runTest {
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":{"code":"invalid_grant","message":"This sign-in code has expired (codes last 60 seconds). Sign in again.","requestId":"r"}}"""))
        auth.begin(connection)
        val result = auth.complete("crowtech.crowhr:/oauth2redirect?code=c&state=${auth.pending()!!.state}") { connection }
        assertEquals("This sign-in code has expired (codes last 60 seconds). Sign in again.", (result as SignInResult.Failed).message)
        assertNull(tokens.get(connection.key))
    }

    @Test fun expiredAccessTokenIsRefreshedOnceAndRotated() = runTest {
        tokens.put(connection.key, StoredTokens("old-access", "old-refresh", "device-1"))
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":{"code":"unauthenticated","message":"Sign in.","requestId":"r"}}"""))
        server.enqueue(tokenResponse("new-access", "new-refresh"))
        server.enqueue(MockResponse().setBody("""{"unread":3}"""))
        var ended = false
        val api = ApiClient(connection, http, tokens, auth) { ended = true }
        val count = api.get("/api/v1/notifications/unread-count", UnreadCount.serializer())
        assertEquals(3, count.unread)
        val first = server.takeRequest()
        assertEquals("Bearer old-access", first.getHeader("Authorization"))
        val refresh = server.takeRequest()
        assertEquals("/api/v1/native/token", refresh.path)
        assertTrue(refresh.body.readUtf8().contains("\"refreshToken\":\"old-refresh\""))
        assertEquals("Bearer new-access", server.takeRequest().getHeader("Authorization"))
        assertEquals("new-refresh", tokens.get(connection.key)!!.refreshToken)
        assertFalse(ended)
    }

    @Test fun refusedRefreshEndsTheSessionAndClearsTokens() = runTest {
        tokens.put(connection.key, StoredTokens("old-access", "old-refresh", "device-1"))
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":{"code":"session_revoked","message":"Signed out.","requestId":"r"}}"""))
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":{"code":"invalid_grant","message":"This session has ended. Sign in again.","requestId":"r"}}"""))
        var ended = false
        val api = ApiClient(connection, http, tokens, auth) { ended = true }
        try {
            api.get("/api/v1/notifications/unread-count", UnreadCount.serializer())
            fail("expected the session to end")
        } catch (e: ApiException) {
            assertEquals(401, e.status)
            assertEquals("session_ended", e.code)
        }
        assertTrue(ended)
        assertNull(tokens.get(connection.key))
    }

    /**
     * Only Crow HR saying no (its JSON error, such as invalid_grant) ends the session. A rate
     * limit, a timeout or a proxy's own error page in front of the server is temporary: the
     * tokens stay and the request fails like being offline (queued punches wait, nothing is lost).
     */
    @Test fun aTemporaryRefusalOfTheRefreshKeepsTheSession() = runTest {
        val unauthorised = """{"error":{"code":"unauthenticated","message":"Sign in.","requestId":"r"}}"""
        val temporary = listOf(
            MockResponse().setResponseCode(429).setBody("""{"error":{"code":"rate_limited","message":"Too many requests.","requestId":"r"}}"""),
            // (408 is temporary too; OkHttp retries it once by itself, so it isn't scripted here.)
            MockResponse().setResponseCode(403).setHeader("Content-Type", "text/html").setBody("<html>Access denied by the firewall</html>"),
        )
        for (reply in temporary) {
            tokens.put(connection.key, StoredTokens("old-access", "old-refresh", "device-1"))
            server.enqueue(MockResponse().setResponseCode(401).setBody(unauthorised))
            server.enqueue(reply)
            var ended = false
            val api = ApiClient(connection, http, tokens, auth) { ended = true }
            try {
                api.get("/api/v1/notifications/unread-count", UnreadCount.serializer())
                fail("expected a temporary failure")
            } catch (e: crowtech.crowhr.api.OfflineException) {
                assertTrue(e.message!!.contains("try again", ignoreCase = true))
            }
            assertFalse("${reply.status}: session kept", ended)
            assertEquals("${reply.status}: tokens kept", "old-refresh", tokens.get(connection.key)?.refreshToken)
            server.takeRequest()
            server.takeRequest()
        }
    }

    @Test fun theAccessTokenExpiryIsStoredFromTheReply() = runTest {
        val asked = java.time.Instant.parse("2026-11-13T01:00:00Z")
        val timed = NativeAuth(store, tokens, httpFor = { http }, deviceName = "Pixel 9 (Android)", appVersion = "0.1.0", now = { asked })
        server.enqueue(tokenResponse("a1", "r1"))
        timed.begin(connection)
        timed.complete("crowtech.crowhr:/oauth2redirect?code=c&state=${timed.pending()!!.state}") { connection }
        assertEquals(asked.toEpochMilli() + 900_000, tokens.get(connection.key)!!.accessExpiresAtEpochMs)
        server.enqueue(tokenResponse("a2", "r2"))
        assertEquals(RefreshResult.Refreshed, timed.refresh(connection, "a1"))
        assertEquals(asked.toEpochMilli() + 900_000, tokens.get(connection.key)!!.accessExpiresAtEpochMs)
    }

    /** As iOS: renewed a minute before it expires, so requests don't each take a refused round trip. */
    @Test fun anAccessTokenAboutToExpireIsRenewedBeforeTheRequest() = runTest {
        val now = java.time.Instant.parse("2026-11-13T01:00:00Z")
        tokens.put(connection.key, StoredTokens("old-access", "old-refresh", "device-1", now.toEpochMilli() + 30_000))
        server.enqueue(tokenResponse("new-access", "new-refresh"))
        server.enqueue(MockResponse().setBody("""{"unread":3}"""))
        var ended = false
        val api = ApiClient(connection, http, tokens, auth, now = { now }) { ended = true }
        assertEquals(3, api.get("/api/v1/notifications/unread-count", UnreadCount.serializer()).unread)
        assertEquals("/api/v1/native/token", server.takeRequest().path)
        assertEquals("Bearer new-access", server.takeRequest().getHeader("Authorization"))
        assertEquals(2, server.requestCount)
        assertFalse(ended)
        // Valid for longer than a minute: used as it is.
        tokens.put(connection.key, StoredTokens("live-access", "live-refresh", "device-1", now.toEpochMilli() + 61_000))
        server.enqueue(MockResponse().setBody("""{"unread":1}"""))
        api.get("/api/v1/notifications/unread-count", UnreadCount.serializer())
        assertEquals("Bearer live-access", server.takeRequest().getHeader("Authorization"))
        assertEquals(3, server.requestCount)
    }

    @Test fun anEarlyRenewalThatCantReachTheServerStillTriesTheRequest() = runTest {
        val now = java.time.Instant.parse("2026-11-13T01:00:00Z")
        tokens.put(connection.key, StoredTokens("old-access", "old-refresh", "device-1", now.toEpochMilli() + 30_000))
        // A proxy's page instead of the token reply: temporary, so the token is still tried.
        server.enqueue(MockResponse().setResponseCode(503).setBody("<html>Busy</html>"))
        server.enqueue(MockResponse().setBody("""{"unread":2}"""))
        val api = ApiClient(connection, http, tokens, auth, now = { now }) {}
        assertEquals(2, api.get("/api/v1/notifications/unread-count", UnreadCount.serializer()).unread)
        assertEquals("/api/v1/native/token", server.takeRequest().path)
        assertEquals("Bearer old-access", server.takeRequest().getHeader("Authorization"))
        assertEquals("old-refresh", tokens.get(connection.key)!!.refreshToken)
    }

    @Test fun tokensStoredByEarlierVersionsStillRead() {
        store.put("tokens.${connection.key}", """{"accessToken":"a","refreshToken":"r","deviceSessionId":"d"}""")
        val t = tokens.get(connection.key)!!
        assertNull(t.accessExpiresAtEpochMs)
        assertFalse(t.needsRefresh(java.time.Instant.now()))
    }

    @Test fun tokensTravelOnlyInTheAuthorizationHeader() = runTest {
        tokens.put(connection.key, StoredTokens("secret-access", "secret-refresh", "device-1"))
        server.enqueue(MockResponse().setBody("""{"unread":0}"""))
        ApiClient(connection, http, tokens, auth) {}.get("/api/v1/notifications/unread-count", UnreadCount.serializer())
        val r = server.takeRequest()
        assertFalse(r.requestUrl.toString().contains("secret"))
        assertEquals("Bearer secret-access", r.getHeader("Authorization"))
    }

    @Test fun signOutRevokesTheDeviceSessionAndDeletesTokens() = runTest {
        tokens.put(connection.key, StoredTokens("access-x", "refresh-x", "device-1"))
        server.enqueue(MockResponse().setResponseCode(204))
        auth.signOut(connection)
        val r = server.takeRequest()
        assertEquals("POST", r.method)
        assertEquals("/api/v1/native/revoke", r.path)
        assertEquals("Bearer access-x", r.getHeader("Authorization"))
        assertNull(tokens.get(connection.key))
    }

    @Test fun signOutStillDeletesTokensWhenOffline() = runTest {
        tokens.put(connection.key, StoredTokens("access-y", "refresh-y", "device-1"))
        server.shutdown()
        auth.signOut(connection)
        assertNull(tokens.get(connection.key))
    }

    @Test fun deviceNamesAreAtMost60Characters() {
        assertEquals("Pixel 9 (Android)", NativeAuth.deviceName("Google", "Pixel 9"))
        assertEquals("Samsung SM-S928B (Android)", NativeAuth.deviceName("samsung", "SM-S928B"))
        assertTrue(NativeAuth.deviceName("X".repeat(80), "Y".repeat(80)).length <= 60)
    }

    // --- Backup exclusion (spec: tokens "SHALL be excluded from device and cloud backups") ---

    private fun xml(path: String) = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
        .newDocumentBuilder().parse(File(path))

    @Test fun backupIsOffAndExclusionRulesCoverEverything() {
        val manifest = xml("src/main/AndroidManifest.xml")
        val app = manifest.getElementsByTagName("application").item(0) as org.w3c.dom.Element
        val ns = "http://schemas.android.com/apk/res/android"
        assertEquals("false", app.getAttributeNS(ns, "allowBackup"))
        assertEquals("@xml/data_extraction_rules", app.getAttributeNS(ns, "dataExtractionRules"))
        assertEquals("@xml/backup_rules", app.getAttributeNS(ns, "fullBackupContent"))

        val domains = setOf("root", "file", "database", "sharedpref", "external")
        val rules = xml("src/main/res/xml/data_extraction_rules.xml")
        for (section in listOf("cloud-backup", "device-transfer")) {
            val el = rules.getElementsByTagName(section).item(0) as org.w3c.dom.Element
            assertEquals("$section has no include rules", 0, el.getElementsByTagName("include").length)
            val excluded = (0 until el.getElementsByTagName("exclude").length).map {
                val e = el.getElementsByTagName("exclude").item(it) as org.w3c.dom.Element
                assertEquals(".", e.getAttribute("path"))
                e.getAttribute("domain")
            }.toSet()
            assertEquals(section, domains, excluded)
        }
        val legacy = xml("src/main/res/xml/backup_rules.xml")
        assertEquals(0, legacy.getElementsByTagName("include").length)
        val legacyExcluded = (0 until legacy.getElementsByTagName("exclude").length)
            .map { (legacy.getElementsByTagName("exclude").item(it) as org.w3c.dom.Element).getAttribute("domain") }.toSet()
        assertEquals(domains, legacyExcluded)
    }

    @Test fun noEmbeddedWebViewIsUsedForSignIn() {
        val sources = File("src/main/java").walk().filter { it.extension == "kt" }.map { it.readText() }.joinToString("\n")
        assertFalse("sign-in must use the system browser", sources.contains("android.webkit.WebView"))
        assertNotEquals(-1, sources.indexOf("android.support.customtabs.extra.SESSION"))
    }

    private fun tokenResponse(access: String, refresh: String) = MockResponse().setBody(
        """{"accessToken":"$access","tokenType":"Bearer","expiresIn":900,"refreshToken":"$refresh","deviceSessionId":"0190a0a0-0000-7000-8000-000000000001"}""",
    )
}
