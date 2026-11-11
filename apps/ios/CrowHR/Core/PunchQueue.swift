import Foundation

enum PunchKind: String, Codable, Sendable { case `in`, out }

struct PunchLocation: Codable, Equatable, Sendable {
    let latitude: Double
    let longitude: Double
    let accuracyMetres: Double?
}

/// The server's decision for one punch (spec "Offline clock-in queue").
enum PunchOutcome: Codable, Equatable, Sendable {
    case pending
    case accepted(serverPunchId: String, recordedAt: String)
    case flagged(serverPunchId: String, recordedAt: String, flags: [String])
    case rejected(code: String, message: String)

    var isSettled: Bool { if case .pending = self { false } else { true } }
}

/// A clock-in or clock-out tapped on this phone. Append-only: the tap's data never changes after
/// it is queued; only delivery bookkeeping and the server's outcome are added.
struct QueuedPunch: Codable, Identifiable, Equatable, Sendable {
    let id: UUID
    /// Sent as `idempotencyKey` on every attempt, so a retry after a lost response returns the
    /// original punch instead of creating a second one.
    let idempotencyKey: String
    let kind: PunchKind
    /// Whose punch this is: never sent while someone else is signed in on this connection.
    let membershipId: String
    /// Device wall clock at the tap.
    let deviceTime: Date
    /// Monotonic seconds since boot at the tap (elapsed-time measurement only).
    let uptimeAtTap: TimeInterval
    /// The boot session at the tap: `elapsedMs` is only meaningful within the same boot.
    var bootSession: String? = nil
    /// Kept on the phone only; the server has no time-zone field.
    let timeZoneOffsetSeconds: Int
    let location: PunchLocation?
    var attempts: Int = 0
    var lastAttemptAt: Date? = nil
    var nextAttemptAt: Date? = nil
    var lastError: String? = nil
    /// Device wall clock when the attempt that reached the server was sent.
    var sentAt: Date? = nil
    var settledAt: Date? = nil
    var outcome: PunchOutcome = .pending
    var replayed: Bool = false
    /// Set when the user dismissed a punch the server refused (explicit action only).
    var dismissedAt: Date? = nil

    var isPending: Bool { !outcome.isSettled }
    var isRejected: Bool { if case .rejected = outcome { true } else { false } }
    /// Refused punches stay on screen, with the server's reason, until the user dismisses them.
    var needsAttention: Bool { isRejected && dismissedAt == nil }

    /// Labels shared word for word with Android (apps/mobile-fixtures/punch-queue-cases.json).
    enum Labels {
        static let pending = "Waiting to send"
        static let pendingRetry = "Not sent yet. The app will retry automatically."
        static let accepted = "Synced"
        static let flaggedNoFlags = "Synced. Flagged for review"
        static let rejectedNoMessage = "Not accepted: the server refused this punch."
        static let late = "Sent late. Your manager may need to review it"
        static func flagged(_ flags: String) -> String { "Synced. Flagged: \(flags)" }
        static func rejected(_ message: String) -> String { "Not accepted: \(message)" }
    }

    /// Marked when the send that settled the punch happened more than 7 days after the tap.
    var isLate: Bool {
        guard outcome.isSettled, let sentAt else { return false }
        return sentAt.timeIntervalSince(deviceTime) > PunchQueue.lateThreshold
    }

    var lateLabel: String? { isLate ? Labels.late : nil }

    func statusLabel() -> String {
        switch outcome {
        case .pending: return attempts == 0 ? Labels.pending : Labels.pendingRetry
        case .accepted: return Labels.accepted
        case .flagged(_, _, let flags):
            return flags.isEmpty ? Labels.flaggedNoFlags : Labels.flagged(flags.map(PunchQueue.flagLabel).joined(separator: ", "))
        case .rejected(_, let message): return message.isEmpty ? Labels.rejectedNoMessage : Labels.rejected(message)
        }
    }

    /// Status line first, then the late line.
    var labels: [String] { [statusLabel()] + (lateLabel.map { [$0] } ?? []) }
}

enum PunchQueueError: Error, Equatable, Sendable {
    case full

    var message: String {
        "200 clock-ins are waiting to send. Connect to the internet so they can be sent, then try again."
    }
}

/// What a send attempt produced.
enum PunchSendResult: Equatable, Sendable {
    case recorded(serverPunchId: String, recordedAt: String, status: String, flags: [String], replayed: Bool)
    /// The server decided: the punch is not recorded (shown with the reason; never retried).
    case rejected(code: String, message: String)
    /// Network or server trouble: keep it, retry later with the same idempotency key.
    case retryLater(String)
    /// Can't send now (signed out): keep everything as it is.
    case blocked(String)
}

protocol PunchSending: Sendable {
    /// `elapsedMs`: monotonic milliseconds since the tap, nil when the phone restarted since.
    func send(_ punch: QueuedPunch, sentAt: Date, queued: Bool, elapsedMs: Int?) async -> PunchSendResult
}

/// The kernel's boot session id: changes on every restart, so a stored uptime is comparable only
/// while it stays the same.
enum BootSession {
    static func current() -> String? {
        var size = 0
        guard sysctlbyname("kern.bootsessionuuid", nil, &size, nil, 0) == 0, size > 0 else { return nil }
        var buffer = [CChar](repeating: 0, count: size)
        guard sysctlbyname("kern.bootsessionuuid", &buffer, &size, nil, 0) == 0 else { return nil }
        return String(decoding: buffer.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self)
    }
}

protocol PunchQueueStoring: Sendable {
    func load() -> [QueuedPunch]
    func save(_ punches: [QueuedPunch]) throws
}

enum DrainStop: String, Equatable, Sendable {
    case network
    case authRequired = "auth_required"
    case waiting
    case busy
}

struct DrainSummary: Equatable, Sendable {
    var sent = 0
    var rejected = 0
    var remaining = 0
    var stop: DrainStop? = nil
    var stoppedReason: String? = nil
}

/// FIFO queue of punches with retry and exponential backoff (add-mobile-apps decision 5).
actor PunchQueue {
    static let capacity = 200
    static let lateThreshold: TimeInterval = 7 * 86_400
    static let settledRetention: TimeInterval = 30 * 86_400
    static let maxBackoff: TimeInterval = 15 * 60
    /// The server accepts `elapsedMs` up to 8 days; beyond that it's left out.
    static let maxElapsedMs = 8 * 86_400_000

    private let store: any PunchQueueStoring
    private let now: @Sendable () -> Date
    private let uptime: @Sendable () -> TimeInterval
    private let bootSession: @Sendable () -> String?
    private var items: [QueuedPunch]
    private var draining = false

    init(store: any PunchQueueStoring,
         now: @escaping @Sendable () -> Date = { Date() },
         uptime: @escaping @Sendable () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
         bootSession: @escaping @Sendable () -> String? = { BootSession.current() }) {
        self.store = store
        self.now = now
        self.uptime = uptime
        self.bootSession = bootSession
        self.items = store.load()
    }

    func all() -> [QueuedPunch] { items }
    func pending() -> [QueuedPunch] { items.filter(\.isPending) }

    static func backoff(afterAttempts attempts: Int) -> TimeInterval {
        min(5 * pow(2, Double(max(attempts, 1) - 1)), maxBackoff)
    }

    static func newIdempotencyKey() -> String { "ios:" + UUID().uuidString.lowercased() }

    static func flagLabel(_ flag: String) -> String {
        switch flag {
        case "clock_skew": "device clock differs from the server"
        case "late_sync": "sent late"
        case "outside_location": "outside the office area"
        case "no_location": "no location"
        case "ip_not_allowed": "not on the office network"
        default: flag
        }
    }

    /// Queues a tap. Refuses (never drops an older punch) when 200 are waiting.
    @discardableResult
    func enqueue(kind: PunchKind, membershipId: String, location: PunchLocation?, timeZone: TimeZone = .current, idempotencyKey: String? = nil) throws(PunchQueueError) -> QueuedPunch {
        guard pending().count < Self.capacity else { throw .full }
        let tap = now()
        let punch = QueuedPunch(
            id: UUID(), idempotencyKey: idempotencyKey ?? Self.newIdempotencyKey(), kind: kind, membershipId: membershipId,
            deviceTime: tap, uptimeAtTap: uptime(), timeZoneOffsetSeconds: timeZone.secondsFromGMT(for: tap),
            location: location)
        var tapped = punch
        tapped.bootSession = bootSession()
        items.append(tapped)
        persist()
        return tapped
    }

    /// Monotonic time since the tap, only within the same boot session.
    func elapsedMs(for punch: QueuedPunch) -> Int? {
        guard let tapBoot = punch.bootSession, let nowBoot = bootSession(), tapBoot == nowBoot else { return nil }
        let up = uptime()
        guard up >= punch.uptimeAtTap else { return nil }
        let ms = Int(((up - punch.uptimeAtTap) * 1000).rounded())
        return ms <= Self.maxElapsedMs ? ms : nil
    }

    /// The user acknowledged a refused punch (it stops being shown). Pending punches can't be dismissed.
    func dismiss(_ id: UUID) {
        guard let i = items.firstIndex(where: { $0.id == id }), items[i].outcome.isSettled else { return }
        items[i].dismissedAt = now()
        persist()
    }

    /// Sends due punches for `membershipId` oldest first. Stops at the first punch that can't be
    /// sent now, so punches never reach the server out of order. `force` ignores the backoff (the
    /// user tapped "Send now", or the network just came back).
    func drain(membershipId: String, using sender: any PunchSending, force: Bool = false) async -> DrainSummary {
        var summary = DrainSummary()
        guard !draining else {
            summary.remaining = pending().count
            summary.stop = .busy
            summary.stoppedReason = "already sending"
            return summary
        }
        draining = true
        defer { draining = false }
        // History bookkeeping: without it every punch ever made stays in the file.
        pruneSettled()
        while let index = items.firstIndex(where: { $0.isPending && $0.membershipId == membershipId }) {
            let punch = items[index]
            let attemptAt = now()
            if !force, let next = punch.nextAttemptAt, next > attemptAt {
                summary.stop = .waiting
                summary.stoppedReason = "waiting to retry"
                break
            }
            // queued = retried before, or sent a minute or more after the tap.
            let queued = punch.attempts > 0 || attemptAt.timeIntervalSince(punch.deviceTime) >= 60
            let result = await sender.send(punch, sentAt: attemptAt, queued: queued, elapsedMs: elapsedMs(for: punch))
            // Re-find: the array may have been appended to while awaiting.
            guard let i = items.firstIndex(where: { $0.id == punch.id }) else { break }
            items[i].attempts += 1
            items[i].lastAttemptAt = attemptAt
            switch result {
            case .recorded(let id, let recordedAt, let status, let flags, let replayed):
                items[i].sentAt = attemptAt
                items[i].settledAt = attemptAt
                items[i].replayed = replayed
                items[i].lastError = nil
                items[i].nextAttemptAt = nil
                items[i].outcome = status == "flagged" || !flags.isEmpty
                    ? .flagged(serverPunchId: id, recordedAt: recordedAt, flags: flags)
                    : .accepted(serverPunchId: id, recordedAt: recordedAt)
                summary.sent += 1
                persist()
            case .rejected(let code, let message):
                items[i].sentAt = attemptAt
                items[i].settledAt = attemptAt
                items[i].lastError = nil
                items[i].nextAttemptAt = nil
                items[i].outcome = .rejected(code: code, message: message)
                summary.rejected += 1
                persist()
            case .retryLater(let reason):
                items[i].lastError = reason
                items[i].nextAttemptAt = attemptAt.addingTimeInterval(Self.backoff(afterAttempts: items[i].attempts))
                summary.stop = .network
                summary.stoppedReason = reason
                persist()
            case .blocked(let reason):
                items[i].attempts -= 1 // waiting for sign-in is not a failed attempt
                items[i].lastError = reason
                summary.stop = .authRequired
                summary.stoppedReason = reason
                persist()
            }
            if summary.stop != nil { break }
        }
        summary.remaining = pending().count
        return summary
    }

    /// Drops settled punches older than 30 days (at the start of every drain). Pending punches,
    /// and refused ones the user hasn't dismissed, are never pruned.
    func pruneSettled() {
        let cutoff = now().addingTimeInterval(-Self.settledRetention)
        let before = items.count
        items.removeAll { p in
            guard let settled = p.settledAt, !p.needsAttention else { return false }
            return settled < cutoff
        }
        if items.count != before { persist() }
    }

    /// Explicit user action only (with confirmation in the UI): delete punches that belong to a
    /// different person, or everything on sign-out after the user confirmed losing unsent punches.
    func discard(where predicate: @Sendable (QueuedPunch) -> Bool) {
        items.removeAll(where: predicate)
        persist()
    }

    private func persist() {
        do { try store.save(items) } catch {
            // Keep the in-memory queue; the next change tries to write again.
        }
    }
}

/// The punch queue on disk: `NSFileProtectionComplete` (unreadable while the phone is locked)
/// and excluded from device backups.
struct FilePunchQueueStore: PunchQueueStoring {
    let fileURL: URL

    static func defaultURL(connectionID: UUID) -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("CrowHR", isDirectory: true)
            .appendingPathComponent("punches-\(connectionID.uuidString.lowercased()).json")
    }

    func load() -> [QueuedPunch] {
        guard let data = try? Data(contentsOf: fileURL) else { return [] }
        if let punches = try? JSONDecoder().decode([QueuedPunch].self, from: data) { return punches }
        // Never overwrite punches the app can't read (say, after a downgrade): keep the file aside.
        let aside = fileURL.deletingPathExtension().appendingPathExtension("unreadable-\(Int(Date().timeIntervalSince1970)).json")
        try? FileManager.default.moveItem(at: fileURL, to: aside)
        return []
    }

    /// Unreadable while the phone is locked (`NSFileProtectionComplete`), written atomically.
    static let writeOptions: Data.WritingOptions = [.atomic, .completeFileProtection]

    func save(_ punches: [QueuedPunch]) throws {
        let dir = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
        var dirURL = dir
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? dirURL.setResourceValues(values)
        // Default date encoding: exact, so a reloaded punch is identical to the one queued.
        try JSONEncoder().encode(punches).write(to: fileURL, options: Self.writeOptions)
        var file = fileURL
        try file.setResourceValues(values)
    }

    func delete() { try? FileManager.default.removeItem(at: fileURL) }
}

final class MemoryPunchQueueStore: PunchQueueStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var saved: [QueuedPunch]
    private(set) var saveCount = 0
    init(_ initial: [QueuedPunch] = []) { saved = initial }
    func load() -> [QueuedPunch] { lock.withLock { saved } }
    func save(_ punches: [QueuedPunch]) throws { lock.withLock { saved = punches; saveCount += 1 } }
}

/// Sends punches to `POST /api/v1/attendance/punches`.
struct APIPunchSender: PunchSending {
    let api: APIClient

    struct Body: Encodable {
        let kind: String
        let idempotencyKey: String
        let deviceTime: String
        let sentAt: String
        let queued: Bool
        let source: String
        let elapsedMs: Int?
        let location: Location?
        struct Location: Encodable { let latitude: Double; let longitude: Double; let accuracyMetres: Double? }
    }

    /// The parts of the punch view the queue needs. `status` is required: a 2xx without it is
    /// not a punch (a captive portal, say) and is retried with the same key.
    struct Response: Decodable {
        let id: String?
        let recordedAt: String?
        let status: String
        let flags: [String]?
        let replayed: Bool?
    }

    static func iso(_ d: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: d)
    }

    func send(_ punch: QueuedPunch, sentAt: Date, queued: Bool, elapsedMs: Int?) async -> PunchSendResult {
        let body = Body(
            kind: punch.kind.rawValue, idempotencyKey: punch.idempotencyKey, deviceTime: Self.iso(punch.deviceTime),
            sentAt: Self.iso(sentAt), queued: queued, source: "ios", elapsedMs: elapsedMs,
            location: punch.location.map { .init(latitude: $0.latitude, longitude: $0.longitude, accuracyMetres: $0.accuracyMetres) })
        let data: Data
        do {
            (data, _) = try await api.raw("POST", "/api/v1/attendance/punches", body: try APIClient.encoder.encode(body), contentType: "application/json")
        } catch let e as APIError {
            switch e {
            case .signedOut(let m): return .blocked(m)
            case .server(401, _, let m): return .blocked(m)
            case .server(let status, let code, let message) where !e.isTransient && (400..<500).contains(status):
                // No error envelope (a proxy's "Forbidden" page): no server reason to show.
                return .rejected(code: code, message: code.hasPrefix("http_") ? "" : message)
            default: return .retryLater(e.message)
            }
        } catch {
            return .retryLater(APIError.offline.message)
        }
        guard let r = try? JSONDecoder().decode(Response.self, from: data) else {
            return .retryLater("The server's reply wasn't a punch. It will be sent again.")
        }
        return .recorded(serverPunchId: r.id ?? "", recordedAt: r.recordedAt ?? "", status: r.status, flags: r.flags ?? [], replayed: r.replayed ?? false)
    }
}
