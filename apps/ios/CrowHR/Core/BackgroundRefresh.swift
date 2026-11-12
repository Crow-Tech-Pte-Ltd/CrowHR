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

/// The local notification to post, and where tapping it goes: the inbox (`route`) or, when it
/// announces one item, that item (`link`, the notification's own web path, and its id so opening
/// it marks it read). Neither is shown: they ride in the notification's `userInfo`.
struct LocalNotice: Equatable, Sendable {
    enum Route: String, Sendable { case approvals, notifications }
    let title: String
    let body: String
    let route: Route
    var link: String? = nil
    var notificationID: String? = nil

    /// Where tapping it opens.
    var target: AppTarget {
        if let link { return AppTarget.from(link: link) }
        return route == .approvals ? .approvals : .notifications
    }

    static let routeKey = "route"
    static let linkKey = "link"
    static let idKey = "notificationId"

    var userInfo: [String: String] {
        var info = [Self.routeKey: route.rawValue]
        if let link { info[Self.linkKey] = link }
        if let notificationID { info[Self.idKey] = notificationID }
        return info
    }

    /// What a tap opens, from the notification's `userInfo`.
    static func tapped(userInfo: [AnyHashable: Any]) -> (target: AppTarget, notificationID: String?) {
        let route = (userInfo[routeKey] as? String).flatMap(Route.init(rawValue:)) ?? .notifications
        let notice = LocalNotice(title: "", body: "", route: route, link: userInfo[linkKey] as? String, notificationID: userInfo[idKey] as? String)
        return (notice.target, notice.notificationID)
    }
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
        content.userInfo = notice.userInfo
        content.threadIdentifier = "crowhr.inbox"
        return content
    }

    func post(_ notice: LocalNotice) async {
        let request = UNNotificationRequest(identifier: "crowhr.inbox.\(UUID().uuidString)", content: Self.content(for: notice), trigger: nil)
        try? await UNUserNotificationCenter.current().add(request)
    }
}

/// One inbox item as far as the refresher needs it: no titles, no names. The link (a web path
/// holding at most an id) lets a tap on the notification open the item.
struct InboxItemRef: Equatable, Sendable {
    let id: String
    let category: String
    let createdAt: String
    let readAt: String?
    var link: String? = nil
}

/// What the refresher asks the notifications endpoint for.
enum InboxRequest: Equatable, Sendable {
    /// Newest first, no cursor: `?pageSize=<n>`.
    case latest(pageSize: Int)
    /// Everything after a server cursor, oldest first, paging until a page is empty.
    case since(String)
    /// Older servers (no `cursor` field): `?unread=true&sort=-createdAt&pageSize=50`.
    case unreadNewest
}

/// The items and, when the server has it, the opaque cursor. `serverHasCursor` is false for
/// servers that predate the cursor (their response has no `cursor` field at all).
struct InboxPage: Equatable, Sendable {
    let items: [InboxItemRef]
    let cursor: String?
    let serverHasCursor: Bool
}

protocol InboxFetching: Sendable {
    func fetch(_ request: InboxRequest) async throws -> InboxPage
}

/// Rules shared with Android (apps/mobile-fixtures/background-refresh-cases.json): only unread
/// items count, the text holds only the count, approvals open the approvals inbox, nothing is
/// posted when notifications are off, and the stored cursor moves either way.
enum InboxCursor {
    struct Outcome: Equatable, Sendable {
        let notice: LocalNotice?
        let cursor: String?
    }

    /// One new item: tapping opens that item (its link); several: the inbox, as before.
    static func notice(for fresh: [InboxItemRef], notificationsEnabled: Bool) -> LocalNotice? {
        let unread = fresh.filter { $0.readAt == nil }
        guard !unread.isEmpty, notificationsEnabled else { return nil }
        let route: LocalNotice.Route = unread.contains { $0.category == "approvals" } ? .approvals : .notifications
        let only = unread.count == 1 ? unread.first : nil
        return LocalNotice(title: BackgroundRefresh.notificationTitle, body: BackgroundRefresh.notificationBody(newItems: unread.count), route: route,
                           link: only?.link, notificationID: only?.link == nil ? nil : only?.id)
    }

    /// The `createdAt` cursor, for servers without the opaque one.
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

/// Background refresh. The stored cursor is either `srv:<opaque server cursor>` (servers from Nov
/// 2026) or a `createdAt` instant (older servers). `srv:` with nothing after it means the server had
/// no notifications yet, so the next refresh counts everything it finds.
actor InboxRefresher {
    static let serverPrefix = "srv:"
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

    private func serverCursor(_ c: String?) -> String { Self.serverPrefix + (c ?? "") }

    /// Sets the cursor to "now" without posting: after sign-in, and whenever the user opens the
    /// notifications inbox (`listCursor` is that list's own cursor, when the server sent one).
    func markAllSeen(listCursor: String? = nil, listHadCursor: Bool = false) async {
        if listHadCursor {
            save(serverCursor(listCursor))
            return
        }
        guard let page = try? await fetcher.fetch(.latest(pageSize: 1)) else { return }
        if page.serverHasCursor {
            save(serverCursor(page.cursor))
        } else if let legacy = try? await fetcher.fetch(.unreadNewest) {
            save(InboxCursor.evaluate(items: legacy.items, cursor: cursor, notificationsEnabled: false).cursor)
        }
    }

    @discardableResult
    func refresh() async throws -> LocalNotice? {
        let stored = cursor
        let on = enabled()
        var notice: LocalNotice? = nil
        if let stored, stored.hasPrefix(Self.serverPrefix) {
            let since = String(stored.dropFirst(Self.serverPrefix.count))
            let page = try await fetcher.fetch(since.isEmpty ? .latest(pageSize: 50) : .since(since))
            notice = InboxCursor.notice(for: page.items, notificationsEnabled: on)
            save(serverCursor(page.cursor ?? (since.isEmpty ? nil : since)))
        } else if stored == nil {
            // First refresh after sign-in: set the cursor, announce nothing.
            let page = try await fetcher.fetch(.latest(pageSize: 1))
            if page.serverHasCursor {
                save(serverCursor(page.cursor))
            } else {
                let legacy = try await fetcher.fetch(.unreadNewest)
                save(InboxCursor.evaluate(items: legacy.items, cursor: nil, notificationsEnabled: on).cursor)
            }
        } else {
            // A createdAt cursor from an older server.
            let page = try await fetcher.fetch(.unreadNewest)
            let outcome = InboxCursor.evaluate(items: page.items, cursor: stored, notificationsEnabled: on)
            notice = outcome.notice
            // The server was upgraded: switch to its cursor from here on.
            save(page.serverHasCursor ? serverCursor(page.cursor) : outcome.cursor)
        }
        if let notice { await poster.post(notice) }
        return notice
    }
}

struct APIInboxFetcher: InboxFetching {
    let api: APIClient
    /// Paging forward stops after this many pages in one background run.
    static let maxPages = 10

    private struct Page: Decodable {
        struct Item: Decodable { let id: String; let category: String; let createdAt: String; let readAt: String?; let link: String? }
        let items: [Item]
        let cursor: String?
        let hasCursor: Bool

        enum CodingKeys: String, CodingKey { case items, cursor }
        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            items = try c.decode([Item].self, forKey: .items)
            hasCursor = c.contains(.cursor)
            cursor = try c.decodeIfPresent(String.self, forKey: .cursor)
        }
    }

    private func get(_ query: [(String, String)]) async throws -> Page {
        try await api.get("/api/v1/notifications", query: query.map { URLQueryItem(name: $0.0, value: $0.1) })
    }

    func fetch(_ request: InboxRequest) async throws -> InboxPage {
        switch request {
        case .latest(let size):
            let p = try await get([("pageSize", String(size))])
            return InboxPage(items: p.items.map(ref), cursor: p.cursor, serverHasCursor: p.hasCursor)
        case .unreadNewest:
            let p = try await get([("unread", "true"), ("sort", "-createdAt"), ("pageSize", "50")])
            return InboxPage(items: p.items.map(ref), cursor: p.cursor, serverHasCursor: p.hasCursor)
        case .since(let since):
            var cursor = since
            var all: [InboxItemRef] = []
            var hasCursor = true
            for _ in 0..<Self.maxPages {
                let p = try await get([("since", cursor), ("pageSize", "50")])
                hasCursor = p.hasCursor
                if let c = p.cursor { cursor = c }
                if p.items.isEmpty { break }
                all += p.items.map(ref)
            }
            return InboxPage(items: all, cursor: cursor, serverHasCursor: hasCursor)
        }
    }

    private func ref(_ i: Page.Item) -> InboxItemRef {
        InboxItemRef(id: i.id, category: i.category, createdAt: i.createdAt, readAt: i.readAt, link: i.link)
    }
}

/// Schedules the next refresh no sooner than 15 minutes from now.
struct RefreshPlanner: Sendable {
    let scheduler: any RefreshScheduling

    func scheduleNext(now: Date) throws {
        try scheduler.submit(identifier: BackgroundRefresh.taskIdentifier, earliestBeginDate: now.addingTimeInterval(BackgroundRefresh.minimumInterval))
    }
}

/// App lock with biometrics (spec: ask again after more than 5 minutes in the background). As on
/// Android, also on a cold start (iOS ends suspended apps often, so most returns after a while
/// start the app afresh), and when the clock went back while in the background.
enum AppLockPolicy {
    static let graceInterval: TimeInterval = 5 * 60

    static func shouldLock(enabled: Bool, unlockedThisLaunch: Bool = true, backgroundedAt: Date?, now: Date) -> Bool {
        guard enabled else { return false }
        guard unlockedThisLaunch else { return true }
        guard let backgroundedAt else { return false }
        return now < backgroundedAt || now.timeIntervalSince(backgroundedAt) > graceInterval
    }
}
