import Foundation
import Security
import Testing
@testable import CrowHR

/// Task 3.3: ASWebAuthenticationSession callback handling, PKCE, Keychain this-device-only with no
/// iCloud sync or backup restore, token refresh and revocation.
@Suite("NativeAuth", .serialized)
struct NativeAuthTests {
    // MARK: PKCE

    static var root: [String: Any] { Fixtures.json("deeplink-cases.json") as? [String: Any] ?? [:] }

    @Test func pkceMatchesTheSharedVectors() throws {
        let vectors = try #require((Self.root["pkce"] as? [String: Any])?["vectors"] as? [[String: String]])
        #expect(!vectors.isEmpty)
        for v in vectors { #expect(PKCE.challenge(for: v["verifier"]!) == v["challenge"]) }
    }

    @Test func generatedVerifierIsAValidRandomS256Pair() {
        let a = PKCE.generate(), b = PKCE.generate()
        #expect(a.verifier.count == 43)
        #expect(a.verifier.allSatisfy { $0.isLetter || $0.isNumber || "-_".contains($0) })
        #expect(a.challenge.count == 43)
        #expect(a.challenge == PKCE.challenge(for: a.verifier))
        #expect(a.verifier != b.verifier)
        #expect(PKCE.randomState() != PKCE.randomState())
        #expect(PKCE.randomState().count >= 22) // at least 16 random bytes
    }

    @Test func authorizeURLMatchesTheSharedOneExactly() throws {
        let a = try #require((Self.root["pkce"] as? [String: Any])?["authorizeUrl"] as? [String: String])
        let url = NativeAuth.authorizeURL(server: try ServerAddress.parse(a["server"]!), org: a["org"]!, challenge: a["challenge"]!, state: a["state"]!, client: a["client"]!)
        #expect(url.absoluteString == a["expected"])
        #expect(a["redirectUri"] == NativeAuth.redirectURI)
        // iOS sends client=ios; otherwise identical.
        let ios = NativeAuth.authorizeURL(server: try ServerAddress.parse(a["server"]!), org: a["org"]!, challenge: a["challenge"]!, state: a["state"]!)
        #expect(ios.absoluteString == a["expected"]!.replacingOccurrences(of: "client=android", with: "client=ios"))
    }

    @Test func verifierNeverAppearsInTheAuthorizeURL() {
        let pkce = PKCE.generate()
        #expect(!NativeAuth.authorizeURL(server: testServer, org: "k", pkce: pkce, state: "state-123456").absoluteString.contains(pkce.verifier))
    }

    // MARK: Callback (ASWebAuthenticationSession hands the app this URL)

    @Test func callbackFixturesFromTheSharedCases() throws {
        let cases = try #require(Self.root["oauthRedirect"] as? [[String: Any]])
        #expect(cases.count >= 10)
        for c in cases {
            let id = c["id"] as! String
            let expected = c["expected"] as! [String: String]
            let url = try #require(URL(string: c["uri"] as! String), "\(id)")
            let result = Result { () throws(NativeAuthError) in try NativeAuth.code(fromCallback: url, expectedState: c["expectedState"] as? String) }
            switch (expected["result"]!, result) {
            case ("code", .success(let code)): #expect(code == expected["code"], "\(id)")
            case ("state_mismatch", .failure(.stateMismatch)): break
            case ("invalid", .failure(.invalidCallback)): break
            case ("error", .failure(.authorizationError(let e))): #expect(e == expected["error"], "\(id)")
            default: Issue.record("\(id): expected \(expected), got \(result)")
            }
        }
    }

    @Test func deviceNameFitsTheServerLimit() {
        #expect(NativeAuth.deviceName(model: "iPhone") == "iPhone (iOS)")
        #expect(NativeAuth.deviceName(model: String(repeating: "x", count: 80)).count == 60)
    }

    // MARK: Keychain

    @Test func keychainItemIsThisDeviceOnlyAfterFirstUnlockAndNeverSynchronised() throws {
        let store = KeychainTokenStore(service: "crowtech.crowhr.tests.\(UUID().uuidString)")
        defer { store.deleteAll() }
        let tokens = TokenSet(accessToken: "a", refreshToken: "r", accessExpiresAt: Date(timeIntervalSince1970: 2_000_000_000), deviceSessionId: "d")
        try store.save(tokens, account: "conn-1")
        #expect(store.load(account: "conn-1") == tokens)
        let attrs = try #require(store.attributes(account: "conn-1"))
        #expect(attrs[kSecAttrAccessible as String] as? String == kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
        let sync = attrs[kSecAttrSynchronizable as String]
        #expect(sync == nil || (sync as? Bool) == false || (sync as? NSNumber)?.boolValue == false)
        store.delete(account: "conn-1")
        #expect(store.load(account: "conn-1") == nil)
    }

    // MARK: Token exchange, refresh, revocation

    private func makeAuth(_ stub: StubTransport, clock: TestClock, store: MemoryTokenStore = MemoryTokenStore()) -> AuthSession {
        AuthSession(server: testServer, account: "conn-1", store: store, transport: stub, now: { clock.now })
    }

    @Test func exchangeSendsCodeVerifierAndDeviceAndStoresTokens() async throws {
        let stub = StubTransport()
        stub.onJSON("POST /api/v1/native/token", tokenJSON())
        let store = MemoryTokenStore()
        let clock = TestClock()
        let auth = makeAuth(stub, clock: clock, store: store)
        let set = try await auth.exchange(code: "code-1", verifier: "v".padding(toLength: 43, withPad: "v", startingAt: 0), deviceName: "iPhone (iOS)", appVersion: "0.1.0 (1)")
        let body = jsonBody(try #require(stub.recorded().first))
        #expect(body["grantType"] as? String == "authorization_code")
        #expect(body["code"] as? String == "code-1")
        #expect((body["codeVerifier"] as? String)?.count == 43)
        #expect(body["deviceName"] as? String == "iPhone (iOS)")
        #expect(set.accessExpiresAt == clock.now.addingTimeInterval(900))
        #expect(store.load(account: "conn-1") == set)
    }

    @Test func failedExchangeStoresNothing() async {
        let stub = StubTransport()
        stub.onJSON("POST /api/v1/native/token", status: 400, #"{"error":{"code":"invalid_grant","message":"This sign-in code has expired (codes last 60 seconds). Sign in again.","requestId":"x"}}"#)
        let store = MemoryTokenStore()
        let auth = makeAuth(stub, clock: TestClock(), store: store)
        await #expect(throws: APIError.server(status: 400, code: "invalid_grant", message: "This sign-in code has expired (codes last 60 seconds). Sign in again.")) {
            _ = try await auth.exchange(code: "c", verifier: "v", deviceName: "d", appVersion: "1")
        }
        #expect(store.load(account: "conn-1") == nil)
    }

    @Test func bearerTokenGoesInTheHeaderNeverTheQuery() async throws {
        let stub = StubTransport()
        stub.onJSON("GET /api/v1/me", meJSON)
        let store = MemoryTokenStore()
        try store.save(TokenSet(accessToken: "tok-1", refreshToken: "r", accessExpiresAt: Date().addingTimeInterval(600), deviceSessionId: "d"), account: "conn-1")
        let api = APIClient(server: testServer, transport: stub, auth: AuthSession(server: testServer, account: "conn-1", store: store, transport: stub))
        let me: Me = try await api.get("/api/v1/me")
        #expect(me.user.displayName == "Ravi Kumar")
        let req = try #require(stub.recorded().first)
        #expect(req.value(forHTTPHeaderField: "Authorization") == "Bearer tok-1")
        #expect(!(req.url?.absoluteString.contains("tok-1") ?? true))
        #expect(req.value(forHTTPHeaderField: "Cookie") == nil)
    }

    @Test func expiredAccessTokenIsRefreshedOnceForConcurrentRequests() async throws {
        let stub = StubTransport()
        stub.delay = .milliseconds(50)
        stub.onJSON("POST /api/v1/native/token", tokenJSON(access: "access-2", refresh: "refresh-2"))
        stub.on("GET /api/v1/me") { r in
            r.value(forHTTPHeaderField: "Authorization") == "Bearer access-2" ? (200, "application/json", Data(meJSON.utf8)) : (401, "application/json", Data())
        }
        let clock = TestClock()
        let store = MemoryTokenStore()
        try store.save(TokenSet(accessToken: "access-1", refreshToken: "refresh-1", accessExpiresAt: clock.now.addingTimeInterval(-1), deviceSessionId: "d"), account: "conn-1")
        let api = APIClient(server: testServer, transport: stub, auth: makeAuth(stub, clock: clock, store: store))
        async let a: Me = api.get("/api/v1/me")
        async let b: Me = api.get("/api/v1/me")
        async let c: Me = api.get("/api/v1/me")
        _ = try await (a, b, c)
        // Presenting refresh-1 twice would look like token theft to the server and revoke the device.
        #expect(stub.count("POST /api/v1/native/token") == 1)
        #expect(jsonBody(stub.recorded().first { StubTransport.key($0) == "POST /api/v1/native/token" }!)["refreshToken"] as? String == "refresh-1")
        #expect(store.load(account: "conn-1")?.refreshToken == "refresh-2")
    }

    @Test func revokedOnTheWebClearsTokensAndSignsOut() async throws {
        let stub = StubTransport()
        stub.onJSON("GET /api/v1/leave/balances", status: 401, #"{"error":{"code":"session_revoked","message":"This device was signed out. Sign in again.","requestId":"x"}}"#)
        stub.onJSON("POST /api/v1/native/token", status: 400, #"{"error":{"code":"invalid_grant","message":"This session has ended. Sign in again.","requestId":"x"}}"#)
        let store = MemoryTokenStore()
        try store.save(TokenSet(accessToken: "a", refreshToken: "r", accessExpiresAt: Date().addingTimeInterval(600), deviceSessionId: "d"), account: "conn-1")
        let signedOut = SignedOutProbe()
        let api = APIClient(server: testServer, transport: stub, auth: AuthSession(server: testServer, account: "conn-1", store: store, transport: stub)) { await signedOut.record($0) }
        await #expect(throws: APIError.signedOut(message: "Your session has ended. Sign in again.")) {
            let _: LeaveBalanceList = try await api.get("/api/v1/leave/balances")
        }
        #expect(store.load(account: "conn-1") == nil)
        #expect(await signedOut.messages == ["Your session has ended. Sign in again."])
    }

    @Test func networkFailureDuringRefreshKeepsTheSession() async throws {
        struct Down: HTTPTransport { func send(_ r: URLRequest) async throws -> (Data, HTTPURLResponse) { throw URLError(.notConnectedToInternet) } }
        let store = MemoryTokenStore()
        let clock = TestClock()
        try store.save(TokenSet(accessToken: "a", refreshToken: "r", accessExpiresAt: clock.now.addingTimeInterval(-5), deviceSessionId: "d"), account: "conn-1")
        let auth = AuthSession(server: testServer, account: "conn-1", store: store, transport: Down(), now: { clock.now })
        await #expect(throws: APIError.offline) { _ = try await auth.accessToken() }
        #expect(store.load(account: "conn-1") != nil)
    }

    // MARK: Whole sign-in through the app model (ASWebAuthenticationSession is faked)

    @MainActor
    @Test func signInHandlesTheBrowserCallbackAndOpensTheApp() async throws {
        let stub = StubTransport()
        stub.onJSON("POST /api/v1/native/token", tokenJSON())
        stub.onJSON("GET /api/v1/me", meJSON)
        let tokens = MemoryTokenStore()
        let env = AppEnvironment(transport: stub, tokens: tokens, kv: MemoryStore(), recorder: nil, outage: nil, isUITest: false, cameraStub: false)
        let model = AppModel(env: env)
        let org = ServerMeta.Organisation(slug: "kampong-kopi", displayName: "Kampong Kopi", logoUrl: nil, signInMethods: [.init(kind: "password", displayName: "Email and password")])
        try model.connect(server: testServer, organisation: org, meta: ServerMeta(serverVersion: "1", apiVersions: ["v1"], features: ["leave"], demo: false, orgSlugRequired: false, organisations: [org]))
        #expect(model.screen == .signIn)

        let browser = FakeBrowser()
        try await model.signIn(with: browser)
        #expect(model.screen == .main)
        let opened = try #require(browser.opened)
        #expect(opened.path() == "/api/v1/native/authorize")
        #expect(browser.scheme == "crowtech.crowhr")
        let exchange = try #require(stub.recorded().first { StubTransport.key($0) == "POST /api/v1/native/token" })
        let challenge = URLComponents(url: opened, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "code_challenge" }?.value
        #expect(PKCE.challenge(for: jsonBody(exchange)["codeVerifier"] as? String ?? "") == challenge)
        #expect(tokens.load(account: model.active!.id.uuidString)?.accessToken == "access-1")
    }

    @MainActor
    @Test func forgedCallbackIsIgnored() async throws {
        let stub = StubTransport()
        let env = AppEnvironment(transport: stub, tokens: MemoryTokenStore(), kv: MemoryStore(), recorder: nil, outage: nil, isUITest: false, cameraStub: false)
        let model = AppModel(env: env)
        let org = ServerMeta.Organisation(slug: "k", displayName: "K", logoUrl: nil, signInMethods: [.init(kind: "password", displayName: "P")])
        try model.connect(server: testServer, organisation: org, meta: ServerMeta(serverVersion: "1", apiVersions: ["v1"], features: [], demo: false, orgSlugRequired: false, organisations: [org]))
        let browser = FakeBrowser()
        browser.forgeState = true
        await #expect(throws: NativeAuthError.stateMismatch) { try await model.signIn(with: browser) }
        #expect(stub.count("POST /api/v1/native/token") == 0)
        #expect(model.screen == .signIn)
    }
}

actor SignedOutProbe {
    var messages: [String] = []
    func record(_ m: String) { messages.append(m) }
}

@MainActor
final class FakeBrowser: WebAuthenticating {
    var opened: URL?
    var scheme: String?
    var forgeState = false

    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        opened = url
        scheme = callbackScheme
        let state = forgeState ? "attacker-state" : (URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "state" }?.value ?? "")
        return URL(string: "crowtech.crowhr:/oauth2redirect?code=one-time-code&state=\(state)")!
    }
}
