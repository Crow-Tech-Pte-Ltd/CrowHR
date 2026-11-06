import Foundation

/// User-facing connect messages, shared word for word with Android
/// (apps/mobile-fixtures/connect-cases.json `messages`).
enum ConnectMessages {
    static let invalidURL = "Enter your company's Crow HR address, such as hr.yourcompany.com."
    static let credentialsInURL = "Remove the user name and password from the address. Crow HR asks you to sign in after connecting."
    static let httpsRequired = "This address uses http://, which is not encrypted. Crow HR needs https:// for addresses on the internet. Ask HR for the https:// address."
    static let insecureWarning = "This connection is not encrypted. Only continue on your company's own network."
    static let unreachable = "Could not reach the server. Check your internet connection and the address, then try again."
    static let tlsError = "The server's security certificate could not be verified, so the app did not connect. Ask your administrator to check the server's HTTPS certificate."
    static let notCrowHR = "Could not find Crow HR at this address. Check the address with HR."
    static let appTooOld = "Your company's Crow HR server is newer than this app. Update the Crow HR app to connect."
    static let serverTooOld = "Your company's Crow HR server is older than this app. Ask your administrator to upgrade Crow HR."
    static let orgRequired = "This server hosts more than one organisation. Scan the QR code from Crow HR on the web (My profile → Mobile app) to connect."
    static let orgNotFound = "This server has no organisation with that code. Scan the QR code from Crow HR on the web (My profile → Mobile app)."
    static let noSignInMethods = "Your organisation has not enabled any sign-in method yet. Ask HR to check Settings → Security."
    static let tooManyConnections = "You can save up to 5 connections. Remove one before adding another."

    static func featureUnavailable(_ feature: String) -> String {
        "Your company's Crow HR server is older than this app. \(feature) is available after your administrator upgrades."
    }
}

/// Why an entered server address can't be used.
enum ServerAddressError: Error, Equatable, Sendable {
    case invalidURL
    case credentialsInURL
    case httpsRequired

    /// The fixture outcome code.
    var outcome: String {
        switch self {
        case .invalidURL: "invalid_url"
        case .credentialsInURL: "credentials_in_url"
        case .httpsRequired: "https_required"
        }
    }

    var message: String {
        switch self {
        case .invalidURL: ConnectMessages.invalidURL
        case .credentialsInURL: ConnectMessages.credentialsInURL
        case .httpsRequired: ConnectMessages.httpsRequired
        }
    }
}

/// A Crow HR server base URL the app may talk to. HTTPS always; plain HTTP only for private-range
/// IP addresses, loopback, link-local and `.local` hosts (spec "Connect to a company server"), and
/// then the app warns that the connection is not encrypted.
struct ServerAddress: Codable, Hashable, Sendable {
    /// Normalised: lower-case scheme and host, port and path kept, no query, fragment or trailing slash.
    let url: URL

    var isInsecure: Bool { url.scheme == "http" }
    /// Host without IPv6 brackets.
    var host: String { Self.bare(url.host() ?? "") }

    /// What the user sees, e.g. `hr.example.sg` or `http://192.168.1.20:8080`.
    var display: String {
        var s = url.absoluteString
        if s.hasPrefix("https://") { s.removeFirst("https://".count) }
        return s
    }

    func endpoint(_ path: String) -> URL {
        URL(string: url.absoluteString + (path.hasPrefix("/") ? path : "/" + path))!
    }

    /// Whether `other` points at this server's origin (scheme, host and port all equal).
    func isSameOrigin(_ other: URL) -> Bool {
        guard let scheme = other.scheme?.lowercased(), let h = other.host() else { return false }
        return scheme == url.scheme && Self.bare(h).lowercased() == host && Self.port(other) == Self.port(url)
    }

    private static func port(_ u: URL) -> Int {
        if let p = u.port { return p }
        return u.scheme?.lowercased() == "http" ? 80 : 443
    }

    private static func bare(_ h: String) -> String {
        h.hasPrefix("[") && h.hasSuffix("]") ? String(h.dropFirst().dropLast()) : h
    }

    init(url: URL) { self.url = url }

    static func parse(_ raw: String) throws(ServerAddressError) -> ServerAddress {
        var input = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !input.isEmpty, !input.contains(where: \.isWhitespace) else { throw .invalidURL }
        let lowered = input.lowercased()
        if !lowered.contains("://") {
            // "javascript:alert(1)" and other scheme-only forms are not addresses; "host:8443" is.
            if !input.hasPrefix("["), let colon = input.firstIndex(of: ":") {
                let port = input[input.index(after: colon)...].prefix { $0 != "/" }
                if port.isEmpty || !port.allSatisfy(\.isNumber) { throw .invalidURL }
            }
            input = "https://" + input
        } else if !(lowered.hasPrefix("https://") || lowered.hasPrefix("http://")) {
            throw .invalidURL
        }
        guard let comps = URLComponents(string: input), let rawHost = comps.host, !rawHost.isEmpty else { throw .invalidURL }
        if comps.user != nil || comps.password != nil { throw .credentialsInURL }
        let scheme = (comps.scheme ?? "https").lowercased()
        let host = bare(rawHost).lowercased()
        guard isPlausibleHost(host) else { throw .invalidURL }
        if scheme == "http" && !isPrivateHost(host) { throw .httpsRequired }
        var path = comps.percentEncodedPath
        while path.hasSuffix("/") { path.removeLast() }
        var s = "\(scheme)://\(host.contains(":") ? "[\(host)]" : host)"
        if let p = comps.port { s += ":\(p)" }
        s += path
        guard let url = URL(string: s) else { throw .invalidURL }
        return ServerAddress(url: url)
    }

    private static func isPlausibleHost(_ host: String) -> Bool {
        if parseIPv4(host) != nil { return true }
        if host.contains(":") { return host.allSatisfy { $0.isHexDigit || $0 == ":" || $0 == "." } }
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789-.")
        guard host.unicodeScalars.allSatisfy({ allowed.contains($0) }) else { return false }
        return !host.hasPrefix(".") && !host.hasPrefix("-") && !host.contains("..")
    }

    /// RFC 1918, loopback, link-local, IPv6 ULA / link-local / loopback, `localhost`, `.local`.
    static func isPrivateHost(_ host: String) -> Bool {
        let h = bare(host.lowercased())
        if h == "localhost" || h.hasSuffix(".local") { return true }
        if let o = parseIPv4(h) {
            switch (o[0], o[1]) {
            case (10, _), (127, _): return true
            case (172, 16...31): return true
            case (192, 168): return true
            case (169, 254): return true
            default: return false
            }
        }
        if h.contains(":") {
            if h == "::1" { return true }
            let first = h.split(separator: ":", omittingEmptySubsequences: false).first.map(String.init) ?? ""
            guard let word = UInt16(first.isEmpty ? "0" : first, radix: 16) else { return false }
            if word & 0xFE00 == 0xFC00 { return true } // fc00::/7
            if word & 0xFFC0 == 0xFE80 { return true } // fe80::/10
        }
        return false
    }

    static func parseIPv4(_ host: String) -> [Int]? {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return nil }
        var out: [Int] = []
        for p in parts {
            guard !p.isEmpty, p.count <= 3, p.allSatisfy(\.isASCII), let n = Int(p), (0...255).contains(n) else { return nil }
            out.append(n)
        }
        return out
    }
}

/// `crowhr://connect?server=<PUBLIC_URL>&org=<slug>` from the web app's QR code
/// (apps/mobile-fixtures/deeplink-cases.json). Parsing only: the server is normalised and checked
/// by the connect step. Other parameters are ignored and never stored.
struct ConnectLink: Equatable, Sendable {
    let server: String
    let org: String?

    struct Invalid: Error, Equatable, Sendable {
        var message: String {
            "This isn't a Crow HR connection code. Open My profile → Mobile app in Crow HR on the web and scan the code there."
        }
    }

    static func parse(_ raw: String) throws(Invalid) -> ConnectLink {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let comps = URLComponents(string: trimmed),
              comps.scheme?.lowercased() == "crowhr",
              comps.host?.lowercased() == "connect",
              comps.path.isEmpty || comps.path == "/"
        else { throw Invalid() }
        let items = comps.queryItems ?? []
        let servers = items.filter { $0.name == "server" }
        let orgs = items.filter { $0.name == "org" }
        guard servers.count == 1, orgs.count <= 1,
              let server = servers[0].value?.trimmingCharacters(in: .whitespaces), !server.isEmpty,
              server.lowercased().hasPrefix("https://") || server.lowercased().hasPrefix("http://")
        else { throw Invalid() }
        var org: String? = nil
        if let o = orgs.first {
            let lower = (o.value ?? "").lowercased()
            guard OrgSlug.isValid(lower) else { throw Invalid() }
            org = lower
        }
        return ConnectLink(server: server, org: org)
    }
}

enum OrgSlug {
    /// `^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$`
    static func isValid(_ s: String) -> Bool {
        s.wholeMatch(of: /[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?/) != nil
    }
}
