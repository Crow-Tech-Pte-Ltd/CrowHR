import Foundation
import Testing
@testable import CrowHR

/// Session lifecycle rules (each once a bug): when the app may sign someone out,
/// lock, send punches, mark the inbox seen and revoke a device session.
@Suite("Session", .serialized)
@MainActor
struct SessionTests {
    // MARK: A failed refresh only ends the session when the server says so

    private struct Failing: HTTPTransport {
        let error: URLError
        func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) { throw error }
    }

    private func expiredTokens(_ store: MemoryTokenStore) throws {
        try store.save(TokenSet(accessToken: "a", refreshToken: "r", accessExpiresAt: Date().addingTimeInterval(-5), deviceSessionId: "d"), account: "conn-1")
    }

    @Test func certificateErrorDuringRefreshKeepsTheSession() async throws {
        // A hotel or airport Wi-Fi that intercepts HTTPS: nothing to do with the session.
        let store = MemoryTokenStore()
        try expiredTokens(store)
        let auth = AuthSession(server: testServer, account: "conn-1", store: store, transport: Failing(error: URLError(.serverCertificateUntrusted)))
        await #expect(throws: APIError.tls(host: "hr.example.sg")) { _ = try await auth.accessToken() }
        #expect(store.load(account: "conn-1") != nil)
    }

    @Test func captivePortalPageDuringRefreshKeepsTheSession() async throws {
        let stub = StubTransport()
        stub.on("POST /api/v1/native/token") { _ in (200, "text/html", Data("<html>Sign in to the Wi-Fi</html>".utf8)) }
        let store = MemoryTokenStore()
        try expiredTokens(store)
        let auth = AuthSession(server: testServer, account: "conn-1", store: store, transport: stub)
        await #expect(throws: APIError.unreadable) { _ = try await auth.accessToken() }
        #expect(store.load(account: "conn-1") != nil)
    }

    @Test func proxyErrorPageDuringRefreshKeepsTheSession() async throws {
        // A firewall's or CDN's own "Forbidden" page has no Crow HR error envelope.
        let stub = StubTransport()
        stub.on("POST /api/v1/native/token") { _ in (403, "text/html", Data("<html>Forbidden</html>".utf8)) }
        let store = MemoryTokenStore()
        try expiredTokens(store)
        let auth = AuthSession(server: testServer, account: "conn-1", store: store, transport: stub)
        await #expect(throws: APIError.server(status: 403, code: "http_403", message: "The server returned an error (403). Try again later.")) {
            _ = try await auth.accessToken()
        }
        #expect(store.load(account: "conn-1") != nil)
    }

    // MARK: App model

    private struct Fixture {
        let stub = StubTransport()
        let kv = MemoryStore()
        let tokens = MemoryTokenStore()
        var env: AppEnvironment {
            AppEnvironment(transport: stub, tokens: tokens, kv: kv, recorder: nil, outage: nil, isUITest: false, cameraStub: false)
        }

        /// A saved, active connection; signed in when `token` is given.
        @discardableResult
        func connection(_ server: String = "https://hr.example.sg", org: String = "kampong-kopi", token: String? = nil, membershipId: String? = nil, active: Bool = true) throws -> SavedConnection {
            let store = ConnectionStore(store: kv)
            var c = try store.save(server: try ServerAddress.parse(server), orgSlug: org, orgName: org, features: [], now: Date())
            if let membershipId {
                c.membershipId = membershipId
                store.update(c)
            }
            if active { store.setActive(c.id) }
            if let token {
                try tokens.save(TokenSet(accessToken: token, refreshToken: "r-\(token)", accessExpiresAt: Date().addingTimeInterval(600), deviceSessionId: "d"), account: c.id.uuidString)
            }
            return c
        }
    }

    /// Polls until `condition` holds (the model loads `/me` in a task of its own).
    private func until(_ condition: () -> Bool) async -> Bool {
        for _ in 0..<150 {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(20))
        }
        return condition()
    }

    @Test func biometricLockAppliesOnAColdStartToo() throws {
        // iOS ends suspended apps often: most returns after a while are cold starts.
        let f = Fixture()
        f.kv.set(Data([1]), forKey: "settings.biometric")
        try f.connection(token: "tok")
        let model = AppModel(env: f.env)
        #expect(model.screen == .main)
        #expect(model.locked)
    }

    @Test func noLockOnAColdStartWhenItIsOff() throws {
        let f = Fixture()
        try f.connection(token: "tok")
        #expect(AppModel(env: f.env).locked == false)
    }

    @Test func coldStartDoesNotMarkTheInboxSeen() async throws {
        // A background refresh can launch the app: marking everything seen at launch would
        // swallow the items that refresh is about to announce.
        let f = Fixture()
        f.stub.onJSON("GET /api/v1/me", meJSON)
        f.stub.onJSON("GET /api/v1/notifications", #"{"items":[],"total":0,"unread":0,"cursor":null}"#)
        try f.connection(token: "tok")
        let model = AppModel(env: f.env)
        #expect(await until { f.stub.count("GET /api/v1/meta") == 1 })
        try await Task.sleep(for: .milliseconds(300))
        #expect(model.session?.me != nil)
        #expect(f.stub.count("GET /api/v1/notifications") == 0)
    }

    @Test func signingInMarksTheInboxSeen() async throws {
        let f = Fixture()
        f.stub.onJSON("POST /api/v1/native/token", tokenJSON())
        f.stub.onJSON("GET /api/v1/me", meJSON)
        f.stub.onJSON("GET /api/v1/notifications", #"{"items":[],"total":0,"unread":0,"cursor":null}"#)
        try f.connection()
        let model = AppModel(env: f.env)
        try await model.signIn(with: FakeBrowser())
        #expect(await until { f.stub.count("GET /api/v1/notifications") == 1 })
    }

    @Test func anotherPersonSigningInNeverSendsThePreviousPersonsPunches() async throws {
        let f = Fixture()
        f.stub.delay = .milliseconds(200)
        f.stub.onJSON("POST /api/v1/native/token", tokenJSON())
        f.stub.onJSON("GET /api/v1/me", meJSON) // membership …00cc, not member-A
        f.stub.onJSON("POST /api/v1/attendance/punches", #"{"id":"p","recordedAt":"2026-11-12T01:00:00.000Z","status":"accepted","flags":[],"replayed":false}"#)
        let c = try f.connection(membershipId: "member-A")
        let file = FilePunchQueueStore(fileURL: FilePunchQueueStore.defaultURL(connectionID: c.id))
        defer { file.delete() }
        try await PunchQueue(store: file).enqueue(kind: .in, membershipId: "member-A", location: nil)

        let model = AppModel(env: f.env)
        try await model.signIn(with: FakeBrowser())
        // Before `/me` answers (a connectivity change or the retry timer can drain right now).
        await model.session?.drainPunches(force: true)
        #expect(await until { model.session?.me != nil })
        await model.session?.drainPunches(force: true)
        #expect(f.stub.count("POST /api/v1/attendance/punches") == 0)
        #expect(await model.session?.queue.pending().map(\.membershipId) == ["member-A"])
    }

    @Test func removingAnotherSignedInConnectionRevokesItsDeviceSession() async throws {
        let f = Fixture()
        f.stub.on("POST /api/v1/native/revoke") { _ in (204, "application/json", Data()) }
        let other = try f.connection("https://hr.other.example", org: "other", token: "tok-other", active: false)
        try f.connection(token: "tok-current")
        let model = AppModel(env: f.env)
        await model.remove(other)
        let revoke = f.stub.recorded().filter { StubTransport.key($0) == "POST /api/v1/native/revoke" }
        #expect(revoke.map { $0.value(forHTTPHeaderField: "Authorization") } == ["Bearer tok-other"])
        #expect(revoke.first?.url?.host() == "hr.other.example")
        #expect(f.tokens.load(account: other.id.uuidString) == nil)
        #expect(model.session != nil)
    }

    @Test func whoIsSignedInLoadsOnceTheSignalIsBack() async throws {
        // Started with no signal, `/me` failed and was never tried again: no name, no approvals,
        // and Leave listed without the employee filter.
        let f = Fixture()
        let offline = SimulatedOutage()
        offline.isOn = true
        f.stub.on("GET /api/v1/me") { _ in
            if offline.isOn { throw URLError(.notConnectedToInternet) }
            return (200, "application/json", Data(meJSON.utf8))
        }
        try f.connection(token: "tok")
        let model = AppModel(env: f.env)
        #expect(await until { f.stub.count("GET /api/v1/me") == 1 && model.session?.meLoad == nil })
        #expect(model.session?.me == nil)
        offline.isOn = false
        await model.refreshMeIfNeeded()
        #expect(model.session?.me?.user.displayName == "Ravi Kumar")
        // Known now: no more fetches.
        await model.refreshMeIfNeeded()
        #expect(f.stub.count("GET /api/v1/me") == 2)
    }

    @Test func switchingConnectionStartsOnToday() throws {
        let f = Fixture()
        let other = try f.connection("https://hr.other.example", org: "other", token: "tok-other", active: false)
        try f.connection(token: "tok")
        let model = AppModel(env: f.env)
        model.selectedTab = .claims
        model.morePath = [.claims]
        model.switchTo(other)
        #expect(model.selectedTab == .today)
        #expect(model.morePath.isEmpty)
    }

    @Test func approvalsShowForAnyoneWithTasksWaiting() async throws {
        // A step can go to a reporting-line manager without the role, a named person or
        // out-of-office cover: the role alone hid their tasks.
        #expect(ApprovalsAccess.shows(featureAvailable: true, mayApprove: false, tasksWaiting: 2))
        #expect(!ApprovalsAccess.shows(featureAvailable: true, mayApprove: false, tasksWaiting: 0))
        #expect(!ApprovalsAccess.shows(featureAvailable: true, mayApprove: false, tasksWaiting: nil))
        #expect(ApprovalsAccess.shows(featureAvailable: true, mayApprove: true, tasksWaiting: nil))
        #expect(!ApprovalsAccess.shows(featureAvailable: false, mayApprove: true, tasksWaiting: 3))
        // The app asks the server once it knows who is signed in (meJSON has no roles).
        let f = Fixture()
        f.stub.onJSON("GET /api/v1/me", meJSON)
        f.stub.onJSON("GET /api/v1/approvals/tasks", #"""
        {"items":[{"taskId":"0190a0b0-0000-7000-8000-0000000000d1","requestId":"0190a0b0-0000-7000-8000-0000000000d2","subjectType":"leave","subjectLabel":"Leave","title":"Annual leave, 3 Dec 2026","requester":{"name":"Tan Wei Ming"},"submittedAt":"2026-11-12T01:00:00.000Z","dueOn":null,"overdueDays":0,"origin":"delegated","onBehalfOf":"Wong Kai Wen","inline":true,"step":{"position":1,"of":1,"label":"Manager"}}]}
        """#)
        try f.connection(token: "tok")
        let model = AppModel(env: f.env)
        #expect(await until { model.session?.approvalTasksWaiting == 1 })
        #expect(model.session?.me?.mayApprove == false)
    }

    @Test func onlyTheServersOwnRefusalEndsASession() {
        #expect(APIError.server(status: 400, code: "invalid_grant", message: "x").endsSession)
        #expect(APIError.server(status: 401, code: "session_revoked", message: "x").endsSession)
        #expect(!APIError.server(status: 403, code: "http_403", message: "x").endsSession)
        #expect(!APIError.server(status: 429, code: "rate_limited", message: "x").endsSession)
        #expect(!APIError.server(status: 503, code: "http_503", message: "x").endsSession)
        #expect(!APIError.tls(host: "h").endsSession)
        #expect(!APIError.unreadable.endsSession)
        #expect(!APIError.offline.endsSession)
    }
}
