import Foundation

/// The one network seam. Production uses `URLSessionTransport`; tests use a stub; UI tests wrap it
/// in `RecordingTransport` to prove the network allow-list.
protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

/// Hands every redirect back to the caller instead of following it, as Android does
/// (`followRedirects(false)`): a 3xx from the server, a proxy, a captive portal or a sign-in
/// gateway would otherwise take the request (and its bearer token) to whatever host it names.
final class RefuseRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest) async -> URLRequest? {
        nil
    }
}

struct URLSessionTransport: HTTPTransport {
    let session: URLSession

    /// Ephemeral: no cookies, no shared credential store and no URL cache, so nothing the server
    /// returns (payslips included) is written to disk by the URL loading system. Redirects are
    /// not followed: the 3xx itself is the answer (`http_3xx`, not a session end; a punch waits).
    static func makeSession(configuration: URLSessionConfiguration = .ephemeral) -> URLSession {
        let config = configuration
        config.urlCache = nil
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.urlCredentialStorage = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 20
        config.waitsForConnectivity = false
        return URLSession(configuration: config, delegate: RefuseRedirects(), delegateQueue: nil)
    }

    init(session: URLSession = URLSessionTransport.makeSession()) { self.session = session }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}

/// Records every request's origin (UI-test builds only) so the ESS journey can assert that the
/// app contacted nothing but the configured server.
actor NetworkRecorder {
    private(set) var origins: [String] = []
    func record(_ url: URL) {
        var o = "\(url.scheme ?? "?")://\(url.host() ?? "?")"
        if let p = url.port { o += ":\(p)" }
        origins.append(o)
    }
    func distinctOrigins() -> [String] { Array(Set(origins)).sorted() }
}

struct RecordingTransport: HTTPTransport {
    let inner: any HTTPTransport
    let recorder: NetworkRecorder
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        if let url = request.url { await recorder.record(url) }
        let (data, response) = try await inner.send(request)
        // Where the answer came from too: a followed redirect would show up here as another host.
        if let url = response.url, url != request.url { await recorder.record(url) }
        return (data, response)
    }
}

enum APIError: Error, Equatable, Sendable {
    case offline
    case tls(host: String)
    case server(status: Int, code: String, message: String)
    case signedOut(message: String)
    case blockedHost(String)
    case unreadable

    var message: String {
        switch self {
        case .offline: "You're offline, or your company's server can't be reached. Check your connection and try again."
        case .tls: ConnectMessages.tlsError
        case .server(_, _, let m): m
        case .signedOut(let m): m
        case .blockedHost(let h): "Blocked a request to \(h). Crow HR only talks to your company's server."
        case .unreadable: "The server sent a response this app couldn't read. Your server may need an update."
        }
    }

    /// Worth retrying later without user action (offline, timeouts, server errors).
    var isTransient: Bool {
        switch self {
        case .offline: true
        case .server(let status, _, _): status >= 500 || status == 408 || status == 429
        default: false
        }
    }

    var code: String? { if case .server(_, let c, _) = self { c } else { nil } }

    /// The server itself refused the refresh token (a 4xx with its JSON error envelope, such as
    /// `invalid_grant`), so the session is over. A certificate error, an unreadable reply or a
    /// proxy's own error page (a captive portal, a firewall or CDN challenge: no envelope) says
    /// nothing about the session, and signing out there would lose it for nothing.
    var endsSession: Bool {
        guard case .server(let status, let code, _) = self else { return false }
        return (400..<500).contains(status) && !isTransient && !code.hasPrefix("http_")
    }

    /// The request was cancelled (its screen went away), not a failure to show.
    static func isCancellation(_ error: any Error) -> Bool {
        error is CancellationError || (error as? URLError)?.code == .cancelled
    }

    static func from(_ error: any Error, host: String) -> APIError {
        if let e = error as? APIError { return e }
        if let u = error as? URLError {
            switch u.code {
            case .serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateHasUnknownRoot,
                 .serverCertificateNotYetValid, .secureConnectionFailed, .clientCertificateRejected:
                return .tls(host: host)
            case .cancelled: return .offline
            default: return .offline
            }
        }
        return .offline
    }
}

private struct ErrorEnvelope: Decodable {
    struct Issue: Decodable { let message: String }
    struct Details: Decodable { let issues: [Issue]? }
    struct Body: Decodable {
        let code: String
        let message: String
        let details: Details?

        enum CodingKeys: String, CodingKey { case code, message, details }
        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            code = try c.decode(String.self, forKey: .code)
            message = try c.decode(String.self, forKey: .message)
            // `details` differs by error (who decided, a cap, a list): only issues are read.
            details = try? c.decodeIfPresent(Details.self, forKey: .details)
        }
    }
    let error: Body
}

/// The server's error envelope. With several field problems the message only counts them ("Fix 2
/// problems before submitting."), so each problem's own message follows on its own line.
func decodeServerError(status: Int, data: Data) -> APIError {
    if let env = try? JSONDecoder().decode(ErrorEnvelope.self, from: data) {
        let issues = (env.error.details?.issues ?? []).map(\.message).filter { $0 != env.error.message }
        let message = issues.count > 1 ? ([env.error.message] + issues).joined(separator: "\n") : env.error.message
        return .server(status: status, code: env.error.code, message: message)
    }
    return .server(status: status, code: "http_\(status)", message: "The server returned an error (\(status)). Try again later.")
}

/// Holds the device session's tokens. Refreshes are single-flight: two concurrent 401s must not
/// both present the same refresh token, because the server treats reuse as theft and revokes the
/// whole device session (api-platform "Access and refresh tokens").
actor AuthSession {
    let server: ServerAddress
    let account: String
    private let store: any TokenStoring
    private let transport: any HTTPTransport
    private let now: @Sendable () -> Date
    private var tokens: TokenSet?
    private var refreshing: Task<TokenSet, any Error>?
    /// The device session these tokens belong to (kept after `clear`), so this instance only ever
    /// deletes its own tokens, never those of a later sign-in on the same connection.
    private var ownDeviceSession: String?
    /// The Keychain refused the last save: the pair in memory is newer than the stored one.
    private var unsaved = false

    init(server: ServerAddress, account: String, store: any TokenStoring, transport: any HTTPTransport, now: @escaping @Sendable () -> Date = { Date() }) {
        self.server = server
        self.account = account
        self.store = store
        self.transport = transport
        self.now = now
        self.tokens = store.load(account: account)
        self.ownDeviceSession = tokens?.deviceSessionId
    }

    var isSignedIn: Bool { tokens != nil }
    var deviceSessionId: String? { tokens?.deviceSessionId }

    func exchange(code: String, verifier: String, deviceName: String, appVersion: String) async throws -> TokenSet {
        let body: [String: String] = [
            "grantType": "authorization_code", "code": code, "codeVerifier": verifier,
            "deviceName": deviceName, "appVersion": appVersion,
        ]
        let set = try await tokenRequest(body)
        keep(set)
        return set
    }

    /// The server has issued `set` (and, on a refresh, retired the previous pair): it is used from
    /// now on even if the Keychain refuses it, and the save is tried again on the next request.
    /// Dropping it would leave only the retired pair, whose next use the server treats as theft.
    private func keep(_ set: TokenSet) {
        tokens = set
        ownDeviceSession = set.deviceSessionId
        save(set)
    }

    private func save(_ set: TokenSet) {
        do {
            try store.save(set, account: account)
            unsaved = false
        } catch {
            unsaved = true
        }
    }

    /// A valid access token, refreshing first when it is about to expire.
    func accessToken() async throws -> String {
        guard let t = tokens else { throw APIError.signedOut(message: "Sign in to continue.") }
        if unsaved { save(t) }
        if t.needsRefresh(now: now()) { return try await refresh().accessToken }
        return t.accessToken
    }

    /// After a 401: refresh unless another caller already replaced the rejected token.
    func refreshAfterRejection(of rejected: String) async throws -> String {
        guard let t = tokens else { throw APIError.signedOut(message: "Sign in to continue.") }
        if t.accessToken != rejected { return t.accessToken }
        return try await refresh().accessToken
    }

    private func refresh() async throws -> TokenSet {
        if let running = refreshing { return try await running.value }
        guard let current = tokens else { throw APIError.signedOut(message: "Sign in to continue.") }
        let task = Task { try await self.tokenRequest(["grantType": "refresh_token", "refreshToken": current.refreshToken]) }
        refreshing = task
        defer { refreshing = nil }
        do {
            let set = try await task.value
            // Signed out while the refresh was under way: the new pair must not bring it back.
            guard tokens == current else { throw APIError.signedOut(message: "Sign in to continue.") }
            keep(set)
            return set
        } catch let e as APIError where e.endsSession {
            if tokens == current { clear() }
            throw APIError.signedOut(message: "Your session has ended. Sign in again.")
        }
    }

    /// Forgets the tokens and deletes them from the Keychain, unless the Keychain by now holds
    /// another sign-in's (a session's late answer after the person signed in again).
    func clear() {
        tokens = nil
        unsaved = false
        if let stored = store.load(account: account), stored.deviceSessionId != ownDeviceSession { return }
        store.delete(account: account)
    }

    private func tokenRequest(_ body: [String: String]) async throws -> TokenSet {
        var req = URLRequest(url: server.endpoint("/api/v1/native/token"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.httpBody = try JSONEncoder().encode(body)
        let started = now()
        let data: Data, res: HTTPURLResponse
        do { (data, res) = try await transport.send(req) } catch { throw APIError.from(error, host: server.host) }
        guard (200..<300).contains(res.statusCode) else { throw decodeServerError(status: res.statusCode, data: data) }
        guard let decoded = try? JSONDecoder().decode(TokenResponse.self, from: data) else { throw APIError.unreadable }
        return decoded.tokenSet(now: started)
    }
}

/// `/api/v1` client bound to one server origin. Requests to any other origin are refused before
/// they are sent (spec "Zero data collection").
final class APIClient: Sendable {
    let server: ServerAddress
    let transport: any HTTPTransport
    let auth: AuthSession?
    let onSignedOut: @Sendable (String) async -> Void

    init(server: ServerAddress, transport: any HTTPTransport, auth: AuthSession?, onSignedOut: @escaping @Sendable (String) async -> Void = { _ in }) {
        self.server = server
        self.transport = transport
        self.auth = auth
        self.onSignedOut = onSignedOut
    }

    static let decoder = JSONDecoder()
    static let encoder = JSONEncoder()

    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        let (data, _) = try await raw("GET", path, query: query)
        return try decode(data)
    }

    func post<T: Decodable>(_ path: String, json: some Encodable) async throws -> T {
        let (data, _) = try await raw("POST", path, body: try Self.encoder.encode(json), contentType: "application/json")
        return try decode(data)
    }

    /// A POST with no body (an action on a record: submit, withdraw, accept), decoding the reply.
    func post<T: Decodable>(_ path: String) async throws -> T {
        let (data, _) = try await raw("POST", path)
        return try decode(data)
    }

    func postNoContent(_ path: String) async throws {
        _ = try await raw("POST", path)
    }

    func postNoContent(_ path: String, json: some Encodable) async throws {
        _ = try await raw("POST", path, body: try Self.encoder.encode(json), contentType: "application/json")
    }

    private func decode<T: Decodable>(_ data: Data) throws -> T {
        do { return try Self.decoder.decode(T.self, from: data) } catch { throw APIError.unreadable }
    }

    func url(_ path: String, query: [URLQueryItem] = []) -> URL {
        var c = URLComponents(url: server.endpoint(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { c.queryItems = query }
        return c.url!
    }

    func raw(_ method: String, _ path: String, query: [URLQueryItem] = [], body: Data? = nil, contentType: String? = nil, accept: String = "application/json") async throws -> (Data, HTTPURLResponse) {
        let target = url(path, query: query)
        guard server.isSameOrigin(target) else { throw APIError.blockedHost(target.host() ?? "?") }
        var req = URLRequest(url: target)
        req.httpMethod = method
        req.httpBody = body
        req.setValue(accept, forHTTPHeaderField: "Accept")
        if let contentType { req.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        var token: String? = nil
        if let auth {
            do { token = try await auth.accessToken() } catch let e as APIError {
                if case .signedOut(let m) = e { await onSignedOut(m) }
                throw e
            }
            req.setValue("Bearer \(token!)", forHTTPHeaderField: "Authorization")
        }
        var (data, res) = try await send(req)
        if res.statusCode == 401, let auth, let rejected = token {
            do {
                let fresh = try await auth.refreshAfterRejection(of: rejected)
                req.setValue("Bearer \(fresh)", forHTTPHeaderField: "Authorization")
                (data, res) = try await send(req)
            } catch let e as APIError {
                if case .signedOut(let m) = e { await onSignedOut(m) }
                throw e
            }
            if res.statusCode == 401 {
                // Revoked on the web, suspended, or expired: clear and return to sign-in.
                await auth.clear()
                let m = decodeServerError(status: 401, data: data).message
                await onSignedOut(m)
                throw APIError.signedOut(message: m)
            }
        }
        guard (200..<300).contains(res.statusCode) else { throw decodeServerError(status: res.statusCode, data: data) }
        return (data, res)
    }

    private func send(_ req: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do { return try await transport.send(req) } catch { throw APIError.from(error, host: server.host) }
    }

    /// Unauthenticated `GET /api/v1/meta` check (`?org=` only when a slug is known).
    static func metaURL(_ server: ServerAddress, org: String?) -> URL {
        var c = URLComponents(url: server.endpoint("/api/v1/meta"), resolvingAgainstBaseURL: false)!
        if let org { c.queryItems = [URLQueryItem(name: "org", value: org)] }
        return c.url!
    }

    static func checkServer(_ server: ServerAddress, org: String?, transport: any HTTPTransport) async -> ConnectCheck {
        var req = URLRequest(url: metaURL(server, org: org))
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (data, res) = try await transport.send(req)
            return Compatibility.check(status: res.statusCode, contentType: res.value(forHTTPHeaderField: "Content-Type"), body: data, requestedOrg: org)
        } catch {
            if case .tls = APIError.from(error, host: server.host) { return .tlsError }
            return .unreachable
        }
    }
}
