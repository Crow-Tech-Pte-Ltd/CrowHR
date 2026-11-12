import CryptoKit
import Foundation
import XCTest

/// Test data the user-flow tests need beyond `e2e/seed.ts` and `scripts/ios-ui-seed.ts`, set up
/// from the test runner through the test server's public API, like a second phone (as
/// `scripts/ios-store-seed.ts` does): its own native sign-in (PKCE) per person, then the same
/// endpoints the web uses. Fictional e2e data only. Idempotent: what exists is reused, so the
/// tests can run in any order and more than once against one server.
final class TestServerSeed {
    let base: String
    let org = "kampong-kopi"
    let password: String
    private var tokens: [String: String] = [:]

    init(base: String, password: String) {
        self.base = base
        self.password = password
    }

    struct Failure: Error, CustomStringConvertible { let description: String }

    // MARK: Calendar

    static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Asia/Singapore")!
        return c
    }()

    static func day(_ d: Date) -> String { format(d, "yyyy-MM-dd") }
    static func format(_ d: Date, _ pattern: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_SG")
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.dateFormat = pattern
        return f.string(from: d)
    }
    static func date(_ s: String) -> Date {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = calendar.timeZone
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: s)!
    }
    static func addDays(_ s: String, _ n: Int) -> String { day(calendar.date(byAdding: .day, value: n, to: date(s))!) }
    static var today: String { day(Date()) }
    /// Next week's Monday (Singapore).
    static var nextMonday: String {
        let weekday = calendar.component(.weekday, from: date(today)) // 1 = Sunday
        return addDays(today, 7 - ((weekday + 5) % 7))
    }
    /// "Tuesday 17 November", as the app reads a day aloud.
    static func spoken(_ s: String) -> String { format(date(s), "EEEE d MMMM") }
    /// "Tue, 17 Nov", as the app shows a day.
    static func short(_ s: String) -> String { format(date(s), "EEE, d MMM") }

    // MARK: Data the tests use

    /// Next week's HQ roster, published: Nurul Tue and Wed 09:00–17:00, Marcus Mon and Thu
    /// 13:00–21:00 (Monday so that leave he applies for then counts a rostered day), and an open
    /// shift on Friday 07:00–11:00. Returns the days used.
    @discardableResult
    func publishSwapRoster(nurul: String, marcus: String, manager: String) throws -> (nurulDay: String, marcusDay: String, openDay: String) {
        let monday = Self.nextMonday
        let days = (nurul: Self.addDays(monday, 1), nurul2: Self.addDays(monday, 2), marcus: Self.addDays(monday, 3), marcusMon: monday, open: Self.addDays(monday, 4))
        let scopes = try call("GET", "/api/v1/scheduling/scopes", as: manager) as? [String: Any]
        let location = (scopes?["mine"] as? [String: Any])?["locationId"] as? String
        let created = try call("POST", "/api/v1/scheduling/rosters", as: manager, body: ["weekStart": monday, "locationId": location.map { $0 as Any } ?? NSNull()])
        guard let rosterID = (created as? [String: Any])?["id"] as? String else { throw Failure(description: "No roster id: \(String(describing: created))") }
        var roster = try call("GET", "/api/v1/scheduling/rosters/\(rosterID)", as: manager) as? [String: Any] ?? [:]
        let employees = roster["employees"] as? [[String: Any]] ?? []
        func employee(_ name: String) throws -> String {
            guard let id = employees.first(where: { $0["name"] as? String == name })?["id"] as? String else {
                throw Failure(description: "\(name) is not on the roster: \(employees.map { $0["name"] ?? "" })")
            }
            return id
        }
        let nurulID = try employee(Self.nurulName)
        let marcusID = try employee(Self.marcusName)
        let shifts = roster["shifts"] as? [[String: Any]] ?? []
        func has(_ employeeID: String?, on date: String) -> Bool {
            shifts.contains { ($0["employeeId"] as? String) == employeeID && $0["date"] as? String == date && $0["kind"] as? String == "shift" }
        }
        var changed = false
        func add(_ employeeID: String?, _ date: String, _ start: String, _ end: String, break minutes: Int) throws {
            guard !has(employeeID, on: date) else { return }
            _ = try call("POST", "/api/v1/scheduling/rosters/\(rosterID)/shifts", as: manager, body: [
                "employeeId": employeeID.map { $0 as Any } ?? NSNull(), "date": date, "kind": "shift", "startTime": start, "endTime": end, "breakMinutes": minutes,
            ])
            changed = true
        }
        try add(nurulID, days.nurul, "09:00", "17:00", break: 60)
        try add(nurulID, days.nurul2, "09:00", "17:00", break: 60)
        try add(marcusID, days.marcusMon, "13:00", "21:00", break: 60)
        try add(marcusID, days.marcus, "13:00", "21:00", break: 60)
        try add(nil, days.open, "07:00", "11:00", break: 0)
        roster = try call("GET", "/api/v1/scheduling/rosters/\(rosterID)", as: manager) as? [String: Any] ?? [:]
        let status = (roster["roster"] as? [String: Any])?["status"] as? String
        let hasChanges = (roster["roster"] as? [String: Any])?["hasChanges"] as? Bool ?? false
        if changed || status != "published" || hasChanges {
            // Acknowledge what the roster asks to (someone on leave that day), as a manager would.
            let ack = (roster["toAcknowledge"] as? [[String: Any]] ?? []).map { ["shiftId": $0["shiftId"] ?? "", "kind": $0["kind"] ?? ""] }
            _ = try call("POST", "/api/v1/scheduling/rosters/\(rosterID)/publish", as: manager, body: ["acknowledge": ack])
        }
        return (days.nurul, days.marcus, days.open)
    }

    /// A pending swap offer from Nurul to Marcus (her Wednesday for his Thursday), unless Marcus
    /// already has one to answer.
    func ensureSwapOffer(nurul: String, marcus: String, manager: String) throws {
        let mine = try call("GET", "/api/v1/scheduling/me", as: marcus) as? [String: Any] ?? [:]
        let swaps = mine["swaps"] as? [[String: Any]] ?? []
        if swaps.contains(where: { $0["direction"] as? String == "incoming" && $0["status"] as? String == "pending_peer" }) { return }
        let days = try publishSwapRoster(nurul: nurul, marcus: marcus, manager: manager)
        let hers = try call("GET", "/api/v1/scheduling/me", as: nurul) as? [String: Any] ?? [:]
        let free = (hers["shifts"] as? [[String: Any]] ?? []).first {
            $0["kind"] as? String == "shift" && ($0["date"] as? String ?? "") >= Self.addDays(Self.nextMonday, 1) && $0["pendingSwap"] as? Bool != true
        }
        guard let shiftID = free?["id"] as? String, let rosterID = free?["rosterId"] as? String else { throw Failure(description: "Nurul has no free shift to offer") }
        let roster = try call("GET", "/api/v1/scheduling/rosters/\(rosterID)", as: nurul) as? [String: Any] ?? [:]
        guard let marcusID = (roster["employees"] as? [[String: Any]] ?? []).first(where: { $0["name"] as? String == Self.marcusName })?["id"] as? String else {
            throw Failure(description: "Marcus is not on Nurul's roster")
        }
        let his = (roster["shifts"] as? [[String: Any]] ?? []).first {
            $0["employeeId"] as? String == marcusID && $0["date"] as? String == days.marcusDay && $0["pendingSwap"] as? Bool != true
        }
        if let peerShift = his?["id"] as? String {
            _ = try call("POST", "/api/v1/scheduling/swaps", as: nurul, body: ["kind": "swap", "shiftId": shiftID, "peerEmployeeId": marcusID, "peerShiftId": peerShift])
        } else {
            // His Thursday is already in a request: offer him the shift instead.
            _ = try call("POST", "/api/v1/scheduling/swaps", as: nurul, body: ["kind": "giveaway", "shiftId": shiftID, "peerEmployeeId": marcusID])
        }
    }

    /// A child on this person's record (born about ten months ago, a citizen), for unpaid infant
    /// care leave. Returns the child's name.
    @discardableResult
    func ensureChild(of email: String, name: String = "Lim Kai") throws -> String {
        let list = try call("GET", "/api/v1/leave/children", as: email) as? [String: Any] ?? [:]
        let items = list["items"] as? [[String: Any]] ?? []
        if let existing = items.first?["name"] as? String { return existing }
        _ = try call("POST", "/api/v1/leave/children", as: email, body: [
            "name": name, "birthDate": Self.addDays(Self.today, -300), "isCitizen": true, "birthOrder": 1,
        ])
        return name
    }

    /// A draft claim of two expenses, one in ringgit at a rate, so the claim's screen has foreign
    /// amounts and the draft's actions (QA). Reused when one exists.
    func ensureDraftClaim(of email: String) throws {
        let list = try call("GET", "/api/v1/claims?mine=true&pageSize=50", as: email) as? [String: Any] ?? [:]
        if (list["items"] as? [[String: Any]] ?? []).contains(where: { $0["status"] as? String == "draft" }) { return }
        let types = try call("GET", "/api/v1/claims/eligible-types?date=\(Self.today)", as: email) as? [String: Any] ?? [:]
        guard let typeID = (types["items"] as? [[String: Any]])?.first?["id"] as? String else { throw Failure(description: "No claim types for \(email)") }
        _ = try call("POST", "/api/v1/claims", as: email, body: [
            "lines": [
                ["claimTypeId": typeID, "expenseDate": Self.today, "merchant": "Restoran Rebung", "description": "Client lunch in KL",
                 "currency": "MYR", "amountMinor": 12550, "rate": "0.301234"],
                ["claimTypeId": typeID, "expenseDate": Self.today, "merchant": "Grab", "description": "Taxi to the client", "currency": "SGD", "amountMinor": 1840],
            ],
            "submit": false,
        ])
    }

    static let nurulName = "Nurul Huda"
    static let marcusName = "Marcus Lim"

    // MARK: HTTP

    /// A bearer token through the same native sign-in the app uses, as its own device session.
    func token(_ email: String) throws -> String {
        if let t = tokens[email] { return t }
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let verifier = Data(bytes).base64URL
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
        var q = URLComponents(string: base + "/api/v1/native/authorize")!
        q.queryItems = [
            .init(name: "org", value: org), .init(name: "client", value: "ios"), .init(name: "redirect_uri", value: "crowtech.crowhr:/oauth2redirect"),
            .init(name: "code_challenge", value: challenge), .init(name: "code_challenge_method", value: "S256"), .init(name: "state", value: UUID().uuidString),
        ]
        let (_, res) = try send("GET", q.url!, token: nil, body: nil)
        let location = res.value(forHTTPHeaderField: "Location") ?? ""
        guard let native = URLComponents(string: location)?.queryItems?.first(where: { $0.name == "native" })?.value
            ?? location.components(separatedBy: "native=").dropFirst().first?.components(separatedBy: "&").first?.removingPercentEncoding
        else { throw Failure(description: "authorize did not redirect to sign-in: \(res.statusCode) \(location)") }
        let signedIn = try json(send("POST", URL(string: base + "/api/v1/auth/sign-in")!, token: nil,
                                     body: ["org": org, "email": email, "password": password, "nativeRequestId": native]))
        guard let redirect = (signedIn as? [String: Any])?["redirectTo"] as? String,
              let code = URLComponents(string: redirect)?.queryItems?.first(where: { $0.name == "code" })?.value
        else { throw Failure(description: "sign-in gave no code for \(email): \(String(describing: signedIn))") }
        let set = try json(send("POST", URL(string: base + "/api/v1/native/token")!, token: nil,
                                body: ["grantType": "authorization_code", "code": code, "codeVerifier": verifier, "deviceName": "UI test seed"]))
        guard let access = (set as? [String: Any])?["accessToken"] as? String else { throw Failure(description: "No token for \(email)") }
        tokens[email] = access
        return access
    }

    @discardableResult
    func call(_ method: String, _ path: String, as email: String, body: Any? = nil) throws -> Any? {
        try json(send(method, URL(string: base + path)!, token: token(email), body: body))
    }

    private func json(_ r: (Data, HTTPURLResponse)) throws -> Any? {
        guard r.1.statusCode < 400 else {
            throw Failure(description: "\(r.1.url?.path ?? "") -> \(r.1.statusCode) \(String(data: r.0, encoding: .utf8) ?? "")")
        }
        return r.0.isEmpty ? nil : try JSONSerialization.jsonObject(with: r.0)
    }

    private func send(_ method: String, _ url: URL, token: String?, body: Any?) throws -> (Data, HTTPURLResponse) {
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let box = ResultBox()
        let session = URLSession(configuration: .ephemeral, delegate: NoRedirects(), delegateQueue: nil)
        session.dataTask(with: req) { data, response, error in
            box.set(data: data ?? Data(), response: response as? HTTPURLResponse, error: error)
        }.resume()
        guard box.wait(seconds: 30), let response = box.response else {
            throw Failure(description: "\(method) \(url.path): \(box.error.map { "\($0)" } ?? "no response")")
        }
        session.finishTasksAndInvalidate()
        return (box.data, response)
    }
}

/// Keeps the authorize redirect (to the sign-in page) so its `native` id can be read.
private final class NoRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest) async -> URLRequest? { nil }
}

private final class ResultBox: @unchecked Sendable {
    private let lock = NSLock()
    private let done = DispatchSemaphore(value: 0)
    private(set) var data = Data()
    private(set) var response: HTTPURLResponse?
    private(set) var error: (any Error)?

    func set(data: Data, response: HTTPURLResponse?, error: (any Error)?) {
        lock.withLock {
            self.data = data
            self.response = response
            self.error = error
        }
        done.signal()
    }

    func wait(seconds: Double) -> Bool { done.wait(timeout: .now() + seconds) == .success }
}

private extension Data {
    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
