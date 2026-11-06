import Foundation
@testable import CrowHR

/// Scripted HTTP transport: handlers by "METHOD /path", every request recorded.
final class StubTransport: HTTPTransport, @unchecked Sendable {
    typealias Handler = @Sendable (URLRequest) throws -> (Int, String, Data)
    private let lock = NSLock()
    private var handlers: [String: Handler] = [:]
    private(set) var requests: [URLRequest] = []
    var delay: Duration = .zero

    init() {}

    func on(_ key: String, _ handler: @escaping Handler) { lock.withLock { handlers[key] = handler } }

    func onJSON(_ key: String, status: Int = 200, _ json: String) {
        on(key) { _ in (status, "application/json", Data(json.utf8)) }
    }

    func count(_ key: String) -> Int {
        lock.withLock { requests.filter { Self.key($0) == key }.count }
    }

    func recorded() -> [URLRequest] { lock.withLock { requests } }

    static func key(_ r: URLRequest) -> String { "\(r.httpMethod ?? "GET") \(r.url?.path() ?? "")" }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let handler = lock.withLock { () -> Handler? in
            requests.append(request)
            return handlers[Self.key(request)]
        }
        if delay != .zero { try await Task.sleep(for: delay) }
        let (status, type, body) = try handler?(request) ?? (404, "application/json", Data(#"{"error":{"code":"not_found","message":"Not found","requestId":"t"}}"#.utf8))
        let res = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": type])!
        return (body, res)
    }
}

func jsonBody(_ r: URLRequest) -> [String: Any] {
    guard let d = r.httpBody, let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return [:] }
    return o
}

let testServer = try! ServerAddress.parse("https://hr.example.sg")

func tokenJSON(access: String = "access-1", refresh: String = "refresh-1", expiresIn: Int = 900) -> String {
    #"{"accessToken":"\#(access)","tokenType":"Bearer","expiresIn":\#(expiresIn),"refreshToken":"\#(refresh)","deviceSessionId":"0190a0b0-0000-7000-8000-000000000001"}"#
}

let meJSON = #"""
{"user":{"id":"0190a0b0-0000-7000-8000-0000000000aa","email":"staff@kampongkopi.example","displayName":"Ravi Kumar","preferredName":null,"fullName":"Ravi Kumar"},
 "organisation":{"id":"0190a0b0-0000-7000-8000-0000000000bb","name":"Kampong Kopi Pte. Ltd.","slug":"kampong-kopi"},
 "membershipId":"0190a0b0-0000-7000-8000-0000000000cc","membershipStatus":"active","employeeId":null,"roles":[],"permissions":{},
 "authMethod":"password","session":{"kind":"device","authenticatedAt":"2026-11-07T01:00:00.000Z"},
 "mfa":{"enrolled":false,"required":false,"graceEndsAt":null,"blocked":false,"remainingRecoveryCodes":0},
 "hasPassword":true,"insecureTransport":false,"demoMode":false,"mailerConfigured":false,"someFutureField":42}
"""#

/// A mutable clock for tests.
final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current: Date
    init(_ start: Date = Date(timeIntervalSince1970: 1_793_000_000)) { current = start }
    var now: Date { lock.withLock { current } }
    func advance(_ seconds: TimeInterval) { lock.withLock { current = current.addingTimeInterval(seconds) } }
    func set(_ d: Date) { lock.withLock { current = d } }
}

/// Shared fixtures from apps/mobile-fixtures (copied unchanged from the Android branch).
enum Fixtures {
    static func url(_ name: String) -> URL? {
        let bundle = Bundle(for: StubTransport.self)
        return bundle.url(forResource: name, withExtension: nil, subdirectory: "mobile-fixtures")
            ?? bundle.url(forResource: name, withExtension: nil)
    }

    static func json(_ name: String) -> Any? {
        guard let u = url(name), let d = try? Data(contentsOf: u) else { return nil }
        return try? JSONSerialization.jsonObject(with: d)
    }
}
