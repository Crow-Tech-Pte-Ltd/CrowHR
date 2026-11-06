import Foundation
import Testing
@testable import CrowHR

/// One `connect-cases.json` case.
struct ConnectCase: CustomTestStringConvertible, Sendable {
    let id: String
    let input: String
    let org: String?
    let meta: [String: any Sendable]?
    let expected: [String: any Sendable]
    var testDescription: String { id }

    static func all() -> [ConnectCase] {
        guard let root = Fixtures.json("connect-cases.json") as? [String: Any], let cases = root["cases"] as? [[String: Any]] else { return [] }
        return cases.map {
            ConnectCase(id: $0["id"] as! String, input: $0["input"] as! String, org: $0["org"] as? String,
                        meta: ($0["meta"] as? [String: Any]).map(sendable), expected: sendable($0["expected"] as! [String: Any]))
        }
    }
}

/// JSONSerialization values are Sendable in practice (immutable Foundation types).
func sendable(_ d: [String: Any]) -> [String: any Sendable] { d.mapValues { $0 as! any Sendable } }

/// Answers the meta request the way a fixture case says.
struct FixtureMetaTransport: HTTPTransport {
    let meta: [String: any Sendable]
    let seen: StubTransport

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        _ = try? await seen.send(request)
        if let network = meta["network"] as? String {
            throw URLError(network == "tls_error" ? .serverCertificateUntrusted : .cannotConnectToHost)
        }
        let status = meta["status"] as! Int
        let body: Data = if let s = meta["body"] as? String { Data(s.utf8) } else { try JSONSerialization.data(withJSONObject: meta["body"]!) }
        let res = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": meta["contentType"] as! String])!
        return (body, res)
    }
}

/// Task 3.2 (the same cases as Android 2.2, from apps/mobile-fixtures/connect-cases.json): meta
/// parsing, the HTTPS rule, the private-range HTTP warning, incompatible servers, feature gates,
/// messages and the 5 saved connections.
@Suite("Connect")
struct ConnectTests {
    static let cases = ConnectCase.all()
    static var root: [String: Any] { Fixtures.json("connect-cases.json") as? [String: Any] ?? [:] }

    @Test func sharedFixturesAreBundled() {
        #expect(Self.cases.count >= 30)
        #expect(Self.root["version"] as? Int == 1)
    }

    @Test(arguments: ConnectCase.all())
    func fixtureCase(_ c: ConnectCase) async throws {
        let outcome = c.expected["outcome"] as! String
        let server: ServerAddress
        do throws(ServerAddressError) {
            server = try ServerAddress.parse(c.input)
        } catch {
            #expect(error.outcome == outcome)
            #expect(c.meta == nil, "no request is made for a refused address")
            #expect(c.expected["server"] is NSNull)
            return
        }
        #expect(server.url.absoluteString == c.expected["server"] as? String)
        let seen = StubTransport()
        let result = await APIClient.checkServer(server, org: c.org, transport: FixtureMetaTransport(meta: try #require(c.meta), seen: seen))
        #expect(result.outcome == outcome)
        #expect(seen.recorded().map { $0.url!.absoluteString } == [c.expected["metaUrl"] as! String])
        if let message = result.message {
            let key = outcome == "ok" ? "" : outcome
            #expect(message == (Self.root["messages"] as? [String: String])?[key])
        }
        guard case .compatible(let meta, let org) = result else { return }
        #expect(server.isInsecure == c.expected["insecure"] as? Bool)
        #expect(org.slug == c.expected["orgSlug"] as? String)
        #expect(org.displayName == c.expected["displayName"] as? String)
        #expect(org.signInMethods.map(\.kind) == c.expected["signInMethodKinds"] as? [String])
        let hidden = AppFeature.allCases.filter { !FeatureGate.isAvailable($0, serverFeatures: meta.features) }.map(\.rawValue)
        #expect(hidden == c.expected["hiddenScreens"] as? [String])
        if let notices = c.expected["featureNotices"] as? [String] {
            #expect(FeatureGate.unavailableMessages(serverFeatures: meta.features) == notices)
        }
    }

    @Test func messagesMatchTheSharedCopy() throws {
        let m = try #require(Self.root["messages"] as? [String: String])
        #expect(ServerAddressError.invalidURL.message == m["invalid_url"])
        #expect(ServerAddressError.credentialsInURL.message == m["credentials_in_url"])
        #expect(ServerAddressError.httpsRequired.message == m["https_required"])
        #expect(ConnectMessages.insecureWarning == m["insecure_warning"])
        #expect(ConnectionStoreError.full.message == m["too_many_connections"])
        #expect(ConnectMessages.featureUnavailable("{feature}") == m["feature_unavailable"])
        #expect(APIError.tls(host: "x").message == m["tls_error"])
    }

    @Test func featureGateTableMatchesTheSharedOne() throws {
        let screens = try #require((Self.root["featureGates"] as? [String: Any])?["screens"] as? [String: [String: Any]])
        #expect(Set(screens.keys) == Set(AppFeature.allCases.map(\.rawValue)))
        for f in AppFeature.allCases {
            let s = try #require(screens[f.rawValue])
            #expect(f.title == s["label"] as? String)
            let requires = s["requires"] as? [String] ?? []
            #expect(FeatureGate.isAvailable(f, serverFeatures: []) == requires.isEmpty, "\(f)")
            #expect(FeatureGate.isAvailable(f, serverFeatures: requires))
        }
    }

    @Test func savedConnectionStepsFromTheSharedFixture() throws {
        let steps = try #require((Self.root["savedConnectionCases"] as? [String: Any])?["steps"] as? [[String: Any]])
        let store = ConnectionStore(store: MemoryStore())
        var clock = Date(timeIntervalSince1970: 1_800_000_000)
        func key(_ c: SavedConnection) -> String { "\(c.server.url.absoluteString)|\(c.orgSlug)" }
        func find(_ k: String) -> SavedConnection? { store.all().first { key($0) == k } }
        for step in steps {
            clock += 1
            let expect = step["expect"] as! [String: Any]
            var result = ""
            switch step["op"] as! String {
            case "add":
                let existed = find("\(step["server"]!)|\(step["orgSlug"]!)") != nil
                do throws(ConnectionStoreError) {
                    let saved = try store.save(server: try! ServerAddress.parse(step["server"] as! String), orgSlug: step["orgSlug"] as! String, orgName: step["displayName"] as! String, features: [], now: clock)
                    store.setActive(saved.id)
                    result = existed ? "updated" : "added"
                } catch { result = "too_many_connections" }
            case "switch":
                store.setActive(try #require(find(step["key"] as! String)).id)
                result = "switched"
            case "remove":
                store.remove(try #require(find(step["key"] as! String)).id)
                result = "removed"
            default: Issue.record("unknown op")
            }
            #expect(result == expect["result"] as? String, "\(step)")
            #expect(store.all().count == expect["count"] as? Int, "\(step)")
            #expect(store.active().map(key) == expect["active"] as? String, "\(step)")
        }
    }

    // MARK: Extra iOS cases

    @Test func sameOriginIsSchemeHostAndPort() throws {
        let s = try ServerAddress.parse("https://hr.example.sg")
        #expect(s.isSameOrigin(URL(string: "https://hr.example.sg/api/v1/me")!))
        #expect(s.isSameOrigin(URL(string: "https://HR.example.sg:443/logo.png")!))
        #expect(!s.isSameOrigin(URL(string: "http://hr.example.sg/api")!))
        #expect(!s.isSameOrigin(URL(string: "https://hr.example.sg:8443/api")!))
        #expect(!s.isSameOrigin(URL(string: "https://cdn.example.sg/logo.png")!))
        #expect(!s.isSameOrigin(URL(string: "https://hr.example.sg.evil.example/")!))
        let v6 = try ServerAddress.parse("http://[fd00::1]:8080")
        #expect(v6.isSameOrigin(URL(string: "http://[fd00::1]:8080/api/v1/me")!))
    }

    @Test func hostWithPortNeedsNoScheme() throws {
        #expect(try ServerAddress.parse("hr.example.sg:8443").url.absoluteString == "https://hr.example.sg:8443")
    }
}

/// `deeplink-cases.json` → `connect`.
struct DeepLinkCase: CustomTestStringConvertible, Sendable {
    let id: String
    let uri: String
    let expected: [String: any Sendable]
    var testDescription: String { id }

    static func connect() -> [DeepLinkCase] {
        guard let root = Fixtures.json("deeplink-cases.json") as? [String: Any], let list = root["connect"] as? [[String: Any]] else { return [] }
        return list.map { DeepLinkCase(id: $0["id"] as! String, uri: $0["uri"] as! String, expected: sendable($0["expected"] as! [String: Any])) }
    }
}

@Suite("ConnectDeepLinks")
struct ConnectDeepLinkTests {
    @Test func casesLoaded() { #expect(DeepLinkCase.connect().count >= 20) }

    @Test(arguments: DeepLinkCase.connect())
    func fixtureCase(_ c: DeepLinkCase) {
        let result = Result { () throws(ConnectLink.Invalid) in try ConnectLink.parse(c.uri) }
        switch (c.expected["result"] as! String, result) {
        case ("ok", .success(let link)):
            #expect(link.server == c.expected["server"] as? String)
            #expect(link.org == c.expected["org"] as? String)
        case ("invalid", .failure): break
        default: Issue.record("\(c.id): expected \(c.expected["result"]!), got \(result)")
        }
    }

    @Test func linkNeverKeepsExtraParameters() throws {
        let link = try ConnectLink.parse("crowhr://connect?server=https%3A%2F%2Fhr.example.com&token=abc")
        #expect(link == ConnectLink(server: "https://hr.example.com", org: nil))
    }
}
