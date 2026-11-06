import BackgroundTasks
import Foundation
import UserNotifications

/// Background refresh of the notifications inbox without remote push (spec "Notifications without
/// remote push"): BGAppRefreshTask, then a local notification whose text holds no personal data.
enum BackgroundRefresh {
    static let taskIdentifier = "crowtech.crowhr.refresh"
    /// iOS decides the real time; this is only the earliest we ask for.
    static let minimumInterval: TimeInterval = 15 * 60
    static let notificationTitle = "Crow HR"

    /// "You have 2 new items in Crow HR": a count only, never names, types or amounts.
    static func notificationBody(newItems: Int) -> String {
        newItems == 1 ? "You have 1 new item in Crow HR" : "You have \(newItems) new items in Crow HR"
    }
}

protocol RefreshScheduling: Sendable {
    func submit(identifier: String, earliestBeginDate: Date) throws
}

struct BGTaskRefreshScheduler: RefreshScheduling {
    func submit(identifier: String, earliestBeginDate: Date) throws {
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = earliestBeginDate
        try BGTaskScheduler.shared.submit(request)
    }
}

/// The local notification to post, and where tapping it goes.
struct LocalNotice: Equatable, Sendable {
    enum Route: String, Sendable { case approvals, notifications }
    let title: String
    let body: String
    let route: Route
}

protocol LocalNotifying: Sendable {
    func post(_ notice: LocalNotice) async
}

struct UserNotificationPoster: LocalNotifying {
    static func content(for notice: LocalNotice) -> UNMutableNotificationContent {
        let content = UNMutableNotificationContent()
        content.title = notice.title
        content.body = notice.body
        content.sound = .default
        content.userInfo = ["route": notice.route.rawValue]
        content.threadIdentifier = "crowhr.inbox"
        return content
    }

    func post(_ notice: LocalNotice) async {
        let request = UNNotificationRequest(identifier: "crowhr.inbox.\(UUID().uuidString)", content: Self.content(for: notice), trigger: nil)
        try? await UNUserNotificationCenter.current().add(request)
    }
}

/// One inbox item as far as the refresher needs it: no titles, no names.
struct InboxItemRef: Equatable, Sendable {
    let id: String
    let category: String
    let createdAt: String
    let readAt: String?
}

protocol InboxFetching: Sendable {
    func unreadItems() async throws -> [InboxItemRef]
}

/// Cursor rules shared with Android (apps/mobile-fixtures/background-refresh-cases.json): the
/// cursor is the newest `createdAt` already seen; new = unread items strictly later than it; no
/// cursor yet means nothing is new; the cursor never moves backwards and moves even when nothing
/// is posted.
enum InboxCursor {
    struct Outcome: Equatable, Sendable {
        let notice: LocalNotice?
        let cursor: String?
    }

    static func evaluate(items: [InboxItemRef], cursor: String?, notificationsEnabled: Bool) -> Outcome {
        let cursorDate = cursor.flatMap(Fmt.parseInstant)
        let newest = items.compactMap { i in Fmt.parseInstant(i.createdAt).map { (i.createdAt, $0) } }.max { $0.1 < $1.1 }
        var nextCursor = cursor
        if let newest, cursorDate.map({ newest.1 > $0 }) ?? true { nextCursor = newest.0 }
        guard let cursorDate else { return Outcome(notice: nil, cursor: nextCursor) }
        let fresh = items.filter { i in
            i.readAt == nil && (Fmt.parseInstant(i.createdAt).map { $0 > cursorDate } ?? false)
        }
        guard !fresh.isEmpty, notificationsEnabled else { return Outcome(notice: nil, cursor: nextCursor) }
        let route: LocalNotice.Route = fresh.contains { $0.category == "approvals" } ? .approvals : .notifications
        return Outcome(notice: LocalNotice(title: BackgroundRefresh.notificationTitle, body: BackgroundRefresh.notificationBody(newItems: fresh.count), route: route), cursor: nextCursor)
    }
}

actor InboxRefresher {
    private let fetcher: any InboxFetching
    private let poster: any LocalNotifying
    private let store: any KeyValueStore
    private let key: String
    private let enabled: @Sendable () -> Bool

    init(fetcher: any InboxFetching, poster: any LocalNotifying, store: any KeyValueStore, account: String, enabled: @escaping @Sendable () -> Bool) {
        self.fetcher = fetcher
        self.poster = poster
        self.store = store
        self.key = "inbox.cursor.\(account)"
        self.enabled = enabled
    }

    var cursor: String? { store.data(forKey: key).flatMap { String(data: $0, encoding: .utf8) } }

    private func save(_ cursor: String?) {
        store.set(cursor.map { Data($0.utf8) }, forKey: key)
    }

    /// The user opened the app: everything currently there counts as seen, nothing is posted.
    func markAllSeen() async {
        guard let items = try? await fetcher.unreadItems() else { return }
        save(InboxCursor.evaluate(items: items, cursor: cursor, notificationsEnabled: false).cursor ?? cursor)
    }

    /// Fetches unread items and posts one content-free notification for new ones.
    @discardableResult
    func refresh() async throws -> LocalNotice? {
        let items = try await fetcher.unreadItems()
        let outcome = InboxCursor.evaluate(items: items, cursor: cursor, notificationsEnabled: enabled())
        save(outcome.cursor)
        if let notice = outcome.notice { await poster.post(notice) }
        return outcome.notice
    }
}

struct APIInboxFetcher: InboxFetching {
    let api: APIClient

    private struct Page: Decodable {
        struct Item: Decodable { let id: String; let category: String; let createdAt: String; let readAt: String? }
        let items: [Item]
    }

    func unreadItems() async throws -> [InboxItemRef] {
        let page: Page = try await api.get("/api/v1/notifications", query: [
            URLQueryItem(name: "unread", value: "true"), URLQueryItem(name: "pageSize", value: "50"),
            URLQueryItem(name: "sort", value: "-createdAt"),
        ])
        return page.items.map { InboxItemRef(id: $0.id, category: $0.category, createdAt: $0.createdAt, readAt: $0.readAt) }
    }
}

/// Schedules the next refresh no sooner than 15 minutes from now.
struct RefreshPlanner: Sendable {
    let scheduler: any RefreshScheduling

    func scheduleNext(now: Date) throws {
        try scheduler.submit(identifier: BackgroundRefresh.taskIdentifier, earliestBeginDate: now.addingTimeInterval(BackgroundRefresh.minimumInterval))
    }
}

/// App lock with biometrics (spec: ask again after more than 5 minutes in the background).
enum AppLockPolicy {
    static let graceInterval: TimeInterval = 5 * 60

    static func shouldLock(enabled: Bool, backgroundedAt: Date?, now: Date) -> Bool {
        guard enabled, let backgroundedAt else { return false }
        return now.timeIntervalSince(backgroundedAt) > graceInterval
    }
}
