import Foundation
import Testing
@testable import CrowHR

/// Plays a fixture drain's `responses` in order, one per request, and records each request body.
final class ScriptedPunchTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var responses: [[String: Any]] = []
    private(set) var bodies: [[String: Any]] = []

    func load(_ r: [[String: Any]]) { lock.withLock { responses = r; bodies = [] } }
    func sentBodies() -> [[String: Any]] { lock.withLock { bodies } }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let next: [String: Any]? = lock.withLock {
            bodies.append(jsonBody(request))
            return responses.isEmpty ? nil : responses.removeFirst()
        }
        guard let next else { throw URLError(.notConnectedToInternet) }
        if let network = next["network"] as? String { throw URLError(network == "timeout" ? .timedOut : .notConnectedToInternet) }
        let status = next["status"] as! Int
        var type = "application/json"
        var body = Data()
        if let s = next["body"] as? String { body = Data(s.utf8); type = "text/html" } else if let o = next["body"] { body = try JSONSerialization.data(withJSONObject: o) }
        return (body, HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": type])!)
    }
}

struct PunchCase: CustomTestStringConvertible, @unchecked Sendable {
    let id: String
    let steps: [[String: Any]]
    var testDescription: String { id }

    static func all() -> [PunchCase] {
        guard let root = Fixtures.json("punch-queue-cases.json") as? [String: Any], let cases = root["cases"] as? [[String: Any]] else { return [] }
        return cases.map { PunchCase(id: $0["id"] as! String, steps: $0["steps"] as! [[String: Any]]) }
    }
}

/// Scripted punch server for the cases the fixture doesn't cover.
actor FakePunchServer: PunchSending {
    struct Sent: Equatable { let key: String; let kind: PunchKind; let deviceTime: Date; let sentAt: Date; let queued: Bool }
    private(set) var sent: [Sent] = []
    var script: [PunchSendResult] = []

    func setScript(_ s: [PunchSendResult]) { script = s }

    func send(_ punch: QueuedPunch, sentAt: Date, queued: Bool) async -> PunchSendResult {
        sent.append(Sent(key: punch.idempotencyKey, kind: punch.kind, deviceTime: punch.deviceTime, sentAt: sentAt, queued: queued))
        if !script.isEmpty { return script.removeFirst() }
        return .recorded(serverPunchId: "srv-\(sent.count)", recordedAt: "2026-11-07T00:58:00.000Z", status: "accepted", flags: [], replayed: false)
    }
}

/// Task 3.4 (the same cases as Android 2.4, from apps/mobile-fixtures/punch-queue-cases.json):
/// FIFO, idempotency key reuse on retry, the 200 cap, the late-send label, never dropping a punch.
@Suite("PunchQueue")
struct PunchQueueTests {
    let me = "member-1"
    static var root: [String: Any] { Fixtures.json("punch-queue-cases.json") as? [String: Any] ?? [:] }

    @Test func sharedFixturesAreBundled() {
        #expect(PunchCase.all().count >= 12)
        #expect((Self.root["rules"] as? [String: Any])?["capacity"] as? Int == PunchQueue.capacity)
    }

    @Test func labelsMatchTheSharedCopy() throws {
        let l = try #require(Self.root["labels"] as? [String: Any])
        #expect(QueuedPunch.Labels.pending == l["pending"] as? String)
        #expect(QueuedPunch.Labels.pendingRetry == l["pendingRetry"] as? String)
        #expect(QueuedPunch.Labels.accepted == l["accepted"] as? String)
        #expect(QueuedPunch.Labels.flagged("{flags}") == l["flagged"] as? String)
        #expect(QueuedPunch.Labels.flaggedNoFlags == l["flaggedNoFlags"] as? String)
        #expect(QueuedPunch.Labels.rejected("{message}") == l["rejected"] as? String)
        #expect(QueuedPunch.Labels.rejectedNoMessage == l["rejectedNoMessage"] as? String)
        #expect(QueuedPunch.Labels.late == l["late"] as? String)
        #expect(PunchQueueError.full.message == l["queueFull"] as? String)
        for (flag, name) in try #require(l["flagNames"] as? [String: String]) { #expect(PunchQueue.flagLabel(flag) == name) }
    }

    @Test(arguments: PunchCase.all())
    func fixtureCase(_ c: PunchCase) async throws {
        let clock = TestClock()
        let transport = ScriptedPunchTransport()
        let api = APIClient(server: testServer, transport: transport, auth: nil)
        let sender = APIPunchSender(api: api)
        let q = PunchQueue(store: MemoryPunchQueueStore(), now: { clock.now }, uptime: { 1 })
        let kinds: [String: PunchKind] = ["in": .in, "out": .out]

        for (n, step) in c.steps.enumerated() {
            let at = "\(c.id) step \(n + 1)"
            let expect = step["expect"] as? [String: Any] ?? [:]
            switch step["op"] as! String {
            case "enqueue":
                clock.set(try #require(Fmt.parseInstant(step["deviceTime"] as! String)))
                var result = "queued"
                do throws(PunchQueueError) {
                    try await q.enqueue(kind: kinds[step["kind"] as! String]!, membershipId: me, location: nil, idempotencyKey: step["key"] as? String)
                } catch { result = "queue_full" }
                #expect(result == expect["result"] as? String, "\(at)")
            case "enqueueMany":
                let start = try #require(Fmt.parseInstant(step["deviceTimeStart"] as! String))
                let count = step["count"] as! Int, digits = step["keyDigits"] as! Int, prefix = step["keyPrefix"] as! String
                let kindList = (step["kinds"] as! [String]).map { kinds[$0]! }
                for i in 0..<count {
                    clock.set(start.addingTimeInterval(Double(i) * (step["stepSeconds"] as! Double)))
                    let number = String(i + 1)
                    let key = prefix + String(repeating: "0", count: max(0, digits - number.count)) + number
                    try await q.enqueue(kind: kindList[i % kindList.count], membershipId: me, location: nil, idempotencyKey: key)
                }
            case "drain":
                let now = try #require(Fmt.parseInstant(step["now"] as! String))
                clock.set(now)
                transport.load(step["responses"] as? [[String: Any]] ?? [])
                let summary = await q.drain(membershipId: me, using: sender)
                if let requests = expect["requests"] as? [[String: Any]] {
                    let sent = transport.sentBodies()
                    #expect(sent.map { $0["idempotencyKey"] as? String } == requests.map { $0["key"] as? String }, "\(at)")
                    #expect(sent.map { $0["queued"] as? Bool } == requests.map { $0["queued"] as? Bool }, "\(at)")
                    for b in sent { #expect(Fmt.parseInstant(b["sentAt"] as! String) == now, "\(at) sentAt") }
                }
                if expect.keys.contains("stopReason") {
                    #expect(summary.stop?.rawValue == expect["stopReason"] as? String, "\(at) stop")
                }
            default:
                Issue.record("unknown op in \(at)")
            }
            let all = await q.all()
            let pending = all.filter(\.isPending).map(\.idempotencyKey)
            if let keys = expect["pending"] as? [String] { #expect(pending == keys, "\(at) pending") }
            if let count = expect["pendingCount"] as? Int { #expect(pending.count == count, "\(at) pendingCount") }
            if let first = expect["firstPending"] as? String { #expect(pending.first == first, "\(at) firstPending") }
            if let last = expect["lastPending"] as? String { #expect(pending.last == last, "\(at) lastPending") }
            let byKey = Dictionary(uniqueKeysWithValues: all.map { ($0.idempotencyKey, $0) })
            for (key, state) in expect["states"] as? [String: String] ?? [:] {
                let p = try #require(byKey[key], "\(at) \(key)")
                let actual = switch p.outcome {
                case .pending: "pending"
                case .accepted: "synced"
                case .flagged: "flagged"
                case .rejected: "rejected"
                }
                #expect(actual == state, "\(at) \(key) state")
            }
            for (key, labels) in expect["labels"] as? [String: [String]] ?? [:] {
                #expect(byKey[key]?.labels == labels, "\(at) \(key) labels")
            }
            if let late = expect["late"] as? [String] {
                #expect(all.filter(\.isLate).map(\.idempotencyKey) == late, "\(at) late")
            }
        }
        // Never drops: every enqueued punch is still there.
        let enqueued = c.steps.reduce(0) { n, s in
            n + (s["op"] as? String == "enqueueMany" ? s["count"] as! Int : (s["op"] as? String == "enqueue" && (s["expect"] as? [String: Any])?["result"] as? String == "queued") ? 1 : 0)
        }
        #expect(await q.all().count == enqueued)
    }

    // MARK: Extra iOS cases

    @Test func generatedKeysAreUniqueAndMatchTheServerPattern() async throws {
        let q = PunchQueue(store: MemoryPunchQueueStore())
        var keys = Set<String>()
        for _ in 0..<50 { keys.insert(try await q.enqueue(kind: .in, membershipId: me, location: nil).idempotencyKey) }
        #expect(keys.count == 50)
        #expect(keys.allSatisfy { $0.wholeMatch(of: /[A-Za-z0-9._:-]{8,100}/) != nil })
    }

    @Test func retryWaitsForTheBackoffUnlessForced() async throws {
        #expect(PunchQueue.backoff(afterAttempts: 1) == 5)
        #expect(PunchQueue.backoff(afterAttempts: 2) == 10)
        #expect(PunchQueue.backoff(afterAttempts: 30) == 900)
        let clock = TestClock()
        let q = PunchQueue(store: MemoryPunchQueueStore(), now: { clock.now }, uptime: { 1 })
        let server = FakePunchServer()
        await server.setScript([.retryLater("x")])
        try await q.enqueue(kind: .in, membershipId: me, location: nil)
        _ = await q.drain(membershipId: me, using: server)
        clock.advance(2)
        #expect(await q.drain(membershipId: me, using: server).stop == .waiting)
        #expect(await server.sent.count == 1)
        #expect(await q.drain(membershipId: me, using: server, force: true).sent == 1)
    }

    @Test func anotherPersonsPunchesAreNeverSent() async throws {
        let q = PunchQueue(store: MemoryPunchQueueStore())
        let server = FakePunchServer()
        try await q.enqueue(kind: .in, membershipId: "someone-else", location: nil)
        try await q.enqueue(kind: .in, membershipId: me, location: nil)
        #expect(await q.drain(membershipId: me, using: server).sent == 1)
        #expect(await q.pending().map(\.membershipId) == ["someone-else"])
    }

    @Test func pendingPunchesAreNeverPrunedSettledOnesAfterThirtyDays() async throws {
        let clock = TestClock()
        let q = PunchQueue(store: MemoryPunchQueueStore(), now: { clock.now }, uptime: { 1 })
        let server = FakePunchServer()
        try await q.enqueue(kind: .in, membershipId: me, location: nil)
        _ = await q.drain(membershipId: me, using: server)
        await server.setScript([.retryLater("offline")])
        try await q.enqueue(kind: .out, membershipId: me, location: nil)
        _ = await q.drain(membershipId: me, using: server)
        clock.advance(31 * 86_400)
        await q.pruneSettled()
        let left = await q.all()
        #expect(left.count == 1 && left.first?.kind == .out && left.first?.isPending == true)
    }

    @Test func recordsTapContextForElapsedTimeAndTimeZone() async throws {
        let clock = TestClock()
        let q = PunchQueue(store: MemoryPunchQueueStore(), now: { clock.now }, uptime: { 4_242 })
        let p = try await q.enqueue(kind: .in, membershipId: me, location: nil, timeZone: TimeZone(identifier: "Asia/Singapore")!)
        #expect(p.uptimeAtTap == 4_242)
        #expect(p.timeZoneOffsetSeconds == 8 * 3_600)
        #expect(p.deviceTime == clock.now)
    }

    @Test func locationIsSentOnlyWhenThereIsOne() async throws {
        let transport = ScriptedPunchTransport()
        transport.load([["status": 201, "body": ["status": "accepted", "flags": [String]()]], ["status": 201, "body": ["status": "accepted", "flags": [String]()]]])
        let sender = APIPunchSender(api: APIClient(server: testServer, transport: transport, auth: nil))
        let q = PunchQueue(store: MemoryPunchQueueStore())
        try await q.enqueue(kind: .in, membershipId: me, location: PunchLocation(latitude: 1.2834, longitude: 103.8607, accuracyMetres: 12))
        try await q.enqueue(kind: .out, membershipId: me, location: nil)
        _ = await q.drain(membershipId: me, using: sender)
        let bodies = transport.sentBodies()
        #expect((bodies[0]["location"] as? [String: Double])?["accuracyMetres"] == 12)
        #expect(bodies[1]["location"] == nil)
        #expect(Set(bodies[0].keys) == ["kind", "idempotencyKey", "deviceTime", "sentAt", "queued", "source", "location"])
    }

    @Test func survivesRestartFromDisk() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("punchq-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = FilePunchQueueStore(fileURL: dir.appendingPathComponent("queue.json"))
        let a = try await PunchQueue(store: store).enqueue(kind: .in, membershipId: me, location: PunchLocation(latitude: 1.3, longitude: 103.8, accuracyMetres: nil))
        #expect(await PunchQueue(store: store).all() == [a])
    }

    @Test func queueFileIsProtectedAndExcludedFromBackup() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("punchq-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("queue.json")
        try FilePunchQueueStore(fileURL: url).save([])
        let values = try url.resourceValues(forKeys: [.isExcludedFromBackupKey, .fileProtectionKey])
        #expect(values.isExcludedFromBackup == true)
        #expect(FilePunchQueueStore.writeOptions.contains(.completeFileProtection))
        #if !targetEnvironment(simulator)
        // The simulator has no data protection classes; a device reports the class on the file.
        #expect(values.fileProtection == .complete)
        #endif
    }
}
