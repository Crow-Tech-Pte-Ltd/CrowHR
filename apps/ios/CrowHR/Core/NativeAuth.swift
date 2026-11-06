import CryptoKit
import Foundation
import Security

/// RFC 7636 PKCE (S256) and the random `state`, from the system CSPRNG.
struct PKCE: Equatable, Sendable {
    let verifier: String
    let challenge: String

    static func generate() -> PKCE {
        let verifier = base64URL(randomBytes(32)) // 43 characters
        return PKCE(verifier: verifier, challenge: challenge(for: verifier))
    }

    static func challenge(for verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    static func randomState() -> String { base64URL(randomBytes(32)) }

    static func randomBytes(_ count: Int) -> Data {
        var bytes = [UInt8](repeating: 0, count: count)
        let status = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        precondition(status == errSecSuccess, "SecRandomCopyBytes failed")
        return Data(bytes)
    }

    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

enum NativeAuthError: Error, Equatable, Sendable {
    case cancelled
    /// Not `crowtech.crowhr:/oauth2redirect`, or no code: fixture result `invalid`.
    case invalidCallback
    case stateMismatch
    /// The server returned `error=<code>`.
    case authorizationError(String)
    case exchangeFailed(String)

    var message: String {
        switch self {
        case .cancelled: "Sign-in was cancelled."
        case .invalidCallback:
            "Sign-in didn't finish. Try again; if it keeps happening, ask your administrator to check the server's app settings."
        case .stateMismatch: "This sign-in response didn't match the request, so it was ignored. Sign in again."
        case .authorizationError(let code): "Sign-in was refused (\(code)). Try again, or ask HR if it keeps happening."
        case .exchangeFailed(let m): m
        }
    }
}

/// The server's native authorisation flow (api-platform "Native client authorisation").
enum NativeAuth {
    static let redirectURI = "crowtech.crowhr:/oauth2redirect"
    static let callbackScheme = "crowtech.crowhr"
    static let client = "ios"

    /// RFC 3986 unreserved characters stay as they are; everything else is percent-encoded.
    static func encode(_ s: String) -> String {
        let unreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        return s.addingPercentEncoding(withAllowedCharacters: unreserved) ?? s
    }

    static func authorizeURL(server: ServerAddress, org: String, pkce: PKCE, state: String) -> URL {
        authorizeURL(server: server, org: org, challenge: pkce.challenge, state: state)
    }

    static func authorizeURL(server: ServerAddress, org: String, challenge: String, state: String, client: String = NativeAuth.client) -> URL {
        let params: [(String, String)] = [
            ("org", org), ("client", client), ("redirect_uri", redirectURI),
            ("code_challenge", challenge), ("code_challenge_method", "S256"), ("state", state),
        ]
        let query = params.map { "\($0.0)=\(encode($0.1))" }.joined(separator: "&")
        return URL(string: server.endpoint("/api/v1/native/authorize").absoluteString + "?" + query)!
    }

    /// Validates the ASWebAuthenticationSession callback and returns the one-time code
    /// (apps/mobile-fixtures/deeplink-cases.json `oauthRedirect`). `expectedState` is nil when no
    /// sign-in is in progress, and then nothing is accepted.
    static func code(fromCallback url: URL, expectedState: String?) throws(NativeAuthError) -> String {
        let raw = url.absoluteString
        guard let colon = raw.firstIndex(of: ":"), raw[..<colon].lowercased() == callbackScheme else { throw .invalidCallback }
        let rest = raw[raw.index(after: colon)...]
        guard rest.hasPrefix("/oauth2redirect") else { throw .invalidCallback }
        let after = rest.dropFirst("/oauth2redirect".count)
        guard after.isEmpty || after.hasPrefix("?") else { throw .invalidCallback }
        let items = URLComponents(string: raw)?.queryItems ?? []
        let state = items.first { $0.name == "state" }?.value ?? ""
        guard let expectedState, constantTimeEquals(state, expectedState) else { throw .stateMismatch }
        if let error = items.first(where: { $0.name == "error" })?.value { throw .authorizationError(error) }
        guard let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty else { throw .invalidCallback }
        return code
    }

    static func constantTimeEquals(_ a: String, _ b: String) -> Bool {
        let x = Array(a.utf8), y = Array(b.utf8)
        guard x.count == y.count, !x.isEmpty else { return false }
        var diff: UInt8 = 0
        for i in 0..<x.count { diff |= x[i] ^ y[i] }
        return diff == 0
    }

    /// "iPhone (iOS)": the server shows it in My sessions. At most 60 characters.
    static func deviceName(model: String) -> String {
        String("\(model) (iOS)".prefix(60))
    }
}

/// Tokens from `POST /api/v1/native/token`.
struct TokenSet: Codable, Equatable, Sendable {
    var accessToken: String
    var refreshToken: String
    var accessExpiresAt: Date
    var deviceSessionId: String

    func needsRefresh(now: Date) -> Bool { now.addingTimeInterval(60) >= accessExpiresAt }
}

struct TokenResponse: Decodable, Sendable {
    let accessToken: String
    let tokenType: String
    let expiresIn: Int
    let refreshToken: String
    let deviceSessionId: String

    func tokenSet(now: Date) -> TokenSet {
        TokenSet(accessToken: accessToken, refreshToken: refreshToken, accessExpiresAt: now.addingTimeInterval(TimeInterval(expiresIn)), deviceSessionId: deviceSessionId)
    }
}

// MARK: - Keychain

protocol TokenStoring: Sendable {
    func load(account: String) -> TokenSet?
    func save(_ tokens: TokenSet, account: String) throws
    func delete(account: String)
}

enum KeychainError: Error, Equatable { case status(OSStatus) }

/// Tokens in the iOS Keychain: this device only, available after first unlock, never synchronised
/// to iCloud Keychain and not restored to another device from a backup (spec "Native sign-in and
/// session storage").
struct KeychainTokenStore: TokenStoring {
    static let service = "crowtech.crowhr.session"
    let service: String

    init(service: String = KeychainTokenStore.service) { self.service = service }

    private func baseQuery(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
        ]
    }

    func load(account: String) -> TokenSet? {
        var q = baseQuery(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(TokenSet.self, from: data)
    }

    func save(_ tokens: TokenSet, account: String) throws {
        let data = try JSONEncoder().encode(tokens)
        delete(account: account)
        var q = baseQuery(account)
        q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(q as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError.status(status) }
    }

    func delete(account: String) {
        SecItemDelete(baseQuery(account) as CFDictionary)
    }

    /// The stored item's attributes, for tests that prove the protection class.
    func attributes(account: String) -> [String: Any]? {
        var q = baseQuery(account)
        q[kSecReturnAttributes as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? [String: Any]
    }
}

final class MemoryTokenStore: TokenStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var items: [String: TokenSet] = [:]
    init() {}
    func load(account: String) -> TokenSet? { lock.withLock { items[account] } }
    func save(_ tokens: TokenSet, account: String) throws { lock.withLock { items[account] = tokens } }
    func delete(account: String) { _ = lock.withLock { items.removeValue(forKey: account) } }
}
