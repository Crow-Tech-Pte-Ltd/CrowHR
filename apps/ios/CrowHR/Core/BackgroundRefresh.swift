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

/// One page walk of `GET /api/v1/notifications`: the items and the server's opaque cursor.
struct InboxPage: Equatable, Sendable {
    let items: [InboxItemRef]
    let cursor: String?
}

protocol InboxFetching: Sendable {
    /// `since == nil`: the newest page, and the cursor pointing at the newest item.
    /// `since != nil`: every item after `since`, oldest first, and the cursor after the last one.
    func fetch(since: String?) async throws -> InboxPage
}

/// Item rules shared with Android (apps/mobile-fixtures/background-refresh-cases.json): only
/// unread items count, the text holds only the count, approvals open the approvals inbox, and
/// nothing is posted when the user turned notifications off.
enum InboxCursor {
    struct Outcome: Equatable, Sendable {
        let notice: LocalNotice?
        let cursor: String?
    }

    static func notice(for fresh: [InboxItemRef], notificationsEnabled: Bool) -> LocalNotice? {
        let unread = fresh.filter { $0.readAt == nil }
        guard !unread.isEmpty, notificationsEnabled else { return nil }
        let route: LocalNotice.Route = unread.contains { $0.category == "approvals" } ? .approvals : .notifications
        return LocalNotice(title: BackgroundRefresh.notificationTitle, body: BackgroundRefresh.notificationBody(newItems: unread.count), route: route)
    }

    /// The fixture's device-side form of the cursor (newest `createdAt` seen). Kept to run the
    /// shared cases; the app itself uses the server's opaque `since` cursor (InboxRefresher).
    static func evaluate(items: [InboxItemRef], cursor: String?, notificationsEnabled: Bool) -> Outcome {
        let cursorDate = cursor.flatMap(Fmt.parseInstant)
        let newest = items.compactMap { i in Fmt.parseInstant(i.createdAt).map { (i.createdAt, $0) } }.max { $0.1 < $1.1 }
        var nextCursor = cursor
        if let newest, cursorDate.map({ newest.1 > $0 }) ?? true { nextCursor = newest.0 }
        guard let cursorDate else { return Outcome(notice: nil, cursor: nextCursor) }
        let fresh = items.filter { Fmt.parseInstant($0.createdAt).map { $0 > cursorDate } ?? false }
        return Outcome(notice: notice(for: fresh, notificationsEnabled: notificationsEnabled), cursor: nextCursor)
    }
}

/// Background refresh with the server's `since` cursor (add-approvals-and-notifications).
/// First refresh after sign-in: nothing is new, the cursor is set. Afterwards: everything after the
/// cursor is new. The cursor moves whether or not a notification is posted.
actor InboxRefresher {
    /// Stored when the inbox was empty at the first refresh (the server has no cursor yet): the
    /// next refresh reads from the start and counts what it finds.
    static let emptyInbox = "empty"
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

    /// The user opened the app: what's there now counts as seen, nothing is posted.
    func markAllSeen() async {
        guard let page = try? await fetcher.fetch(since: nil) else { return }
        save(page.cursor ?? Self.emptyInbox)
    }

    @discardableResult
    func refresh() async throws -> LocalNotice? {
        let current = cursor
        let page = try await fetcher.fetch(since: current == Self.emptyInbox ? nil : current)
        save(page.cursor ?? current ?? Self.emptyInbox)
        guard let current else { return nil } // first refresh: nothing is new
        let notice = InboxCursor.notice(for: page.items, notificationsEnabled: enabled())
        if let notice { await poster.post(notice) }
        return notice
    }
}

struct APIInboxFetcher: InboxFetching {
    let api: APIClient
    /// Safety bound on paging forward in one background run.
    static let maxPages = 10

    private struct Page: Decodable {
        struct Item: Decodable { let id: String; let category: String; let createdAt: String; let readAt: String? }
        let items: [Item]
        let cursor: String?
    }

    func fetch(since: String?) async throws -> InboxPage {
        guard let since else {
            let page: Page = try await api.get("/api/v1/notifications", query: [URLQueryItem(name: "pageSize", value: "50")])
            return InboxPage(items: page.items.map(ref), cursor: page.cursor)
        }
        var cursor = since
        var all: [InboxItemRef] = []
        for _ in 0..<Self.maxPages {
            let page: Page = try await api.get("/api/v1/notifications", query: [
                URLQueryItem(name: "since", value: cursor), URLQueryItem(name: "pageSize", value: "50"),
            ])
            if let c = page.cursor { cursor = c }
            if page.items.isEmpty { break }
            all += page.items.map(ref)
        }
        return InboxPage(items: all, cursor: cursor)
    }

    private func ref(_ i: Page.Item) -> InboxItemRef {
        InboxItemRef(id: i.id, category: i.category, createdAt: i.createdAt, readAt: i.readAt)
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
