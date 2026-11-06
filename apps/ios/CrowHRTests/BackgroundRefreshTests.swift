import Foundation
import Testing
import UserNotifications
@testable import CrowHR

final class FakeScheduler: RefreshScheduling, @unchecked Sendable {
    private(set) var submitted: [(String, Date)] = []
    func submit(identifier: String, earliestBeginDate: Date) throws { submitted.append((identifier, earliestBeginDate)) }
}

actor FakePoster: LocalNotifying {
    private(set) var posted: [LocalNotice] = []
    func post(_ notice: LocalNotice) async { posted.append(notice) }
}

/// Behaves like the server's `since` cursor: items in creation order; the cursor ("c:<n>") is the
/// number of items already passed.
final class FakeServerInbox: InboxFetching, @unchecked Sendable {
    private let lock = NSLock()
    private var items: [InboxItemRef] = []
    private var calls: [String?] = []

    func add(_ id: String, category: String, read: Bool = false) {
        lock.withLock {
            items.append(InboxItemRef(id: id, category: category, createdAt: "2026-11-07T0\(items.count % 10):00:00.000Z", readAt: read ? "2026-11-07T09:00:00.000Z" : nil))
        }
    }

    func recordedCalls() -> [String?] { lock.withLock { calls } }

    func fetch(since: String?) async throws -> InboxPage {
        lock.withLock {
            calls.append(since)
            guard let since, let n = Int(since.dropFirst(2)) else {
                return InboxPage(items: Array(items.reversed()), cursor: items.isEmpty ? nil : "c:\(items.count)")
            }
            return InboxPage(items: Array(items.dropFirst(n)), cursor: "c:\(items.count)")
        }
    }
}

/// Task 3.6: BGAppRefreshTask scheduling and a content-free local notification.
@Suite("BackgroundRefresh")
struct BackgroundRefreshTests {
    static var root: [String: Any] { Fixtures.json("background-refresh-cases.json") as? [String: Any] ?? [:] }

    @Test func schedulesTheRegisteredTaskNoSoonerThanFifteenMinutes() throws {
        let scheduler = FakeScheduler()
        let now = Date()
        try RefreshPlanner(scheduler: scheduler).scheduleNext(now: now)
        #expect(scheduler.submitted.count == 1)
        #expect(scheduler.submitted[0].0 == "crowtech.crowhr.refresh")
        #expect(scheduler.submitted[0].1.timeIntervalSince(now) >= 15 * 60)
        let permitted = Bundle.main.object(forInfoDictionaryKey: "BGTaskSchedulerPermittedIdentifiers") as? [String]
        #expect(permitted?.contains(scheduler.submitted[0].0) == true)
    }

    @Test func sharedTextsAndInterval() throws {
        let texts = try #require(Self.root["texts"] as? [String: String])
        #expect(BackgroundRefresh.notificationBody(newItems: 1) == texts["one"])
        #expect(BackgroundRefresh.notificationBody(newItems: 4) == texts["many"]?.replacingOccurrences(of: "{count}", with: "4"))
        #expect(BackgroundRefresh.notificationTitle == texts["title"])
        #expect(Double(Self.root["minimumIntervalMinutes"] as? Int ?? 0) * 60 == BackgroundRefresh.minimumInterval)
    }

    /// The shared cases, on the fixture's device-side (createdAt) form of the cursor.
    @Test func sharedCursorCases() throws {
        let cases = try #require(Self.root["cases"] as? [[String: Any]])
        #expect(cases.count >= 8)
        for c in cases {
            let id = c["id"] as! String
            let items = (c["items"] as! [[String: Any]]).map {
                InboxItemRef(id: $0["id"] as! String, category: $0["category"] as! String, createdAt: $0["createdAt"] as! String, readAt: $0["readAt"] as? String)
            }
            let expected = c["expected"] as! [String: Any]
            let outcome = InboxCursor.evaluate(items: items, cursor: c["cursor"] as? String, notificationsEnabled: c["notificationsEnabled"] as! Bool)
            #expect(outcome.notice?.body == expected["post"] as? String, "\(id) post")
            #expect(outcome.notice?.route.rawValue == expected["opens"] as? String, "\(id) opens")
            #expect(outcome.cursor == expected["cursor"] as? String, "\(id) cursor")
        }
    }

    // MARK: The app's refresher, on the server's `since` cursor

    private func refresher(_ inbox: FakeServerInbox, _ poster: FakePoster, store: MemoryStore = MemoryStore(), enabled: Bool = true) -> InboxRefresher {
        InboxRefresher(fetcher: inbox, poster: poster, store: store, account: "conn-1", enabled: { enabled })
    }

    @Test func firstRefreshSetsTheCursorAndPostsNothing() async throws {
        let inbox = FakeServerInbox()
        inbox.add("n1", category: "approvals")
        let poster = FakePoster()
        let r = refresher(inbox, poster)
        #expect(try await r.refresh() == nil)
        #expect(await r.cursor == "c:1")
        #expect(await poster.posted.isEmpty)
    }

    @Test func newApprovalAfterTheCursorPostsOneContentFreeNotice() async throws {
        let inbox = FakeServerInbox()
        inbox.add("n1", category: "updates")
        let poster = FakePoster()
        let r = refresher(inbox, poster)
        _ = try await r.refresh()
        inbox.add("n2", category: "approvals")
        let notice = try await r.refresh()
        #expect(notice == LocalNotice(title: "Crow HR", body: "You have 1 new item in Crow HR", route: .approvals))
        #expect(inbox.recordedCalls() == [nil, "c:1"])
        #expect(await r.cursor == "c:2")
        #expect(try await r.refresh() == nil)
        #expect(await poster.posted.count == 1)
    }

    @Test func readElsewhereIsNotCountedAndPluralText() async throws {
        let inbox = FakeServerInbox()
        let poster = FakePoster()
        let r = refresher(inbox, poster)
        inbox.add("n0", category: "updates")
        _ = try await r.refresh()
        inbox.add("n1", category: "claims", read: true)
        inbox.add("n2", category: "leave")
        inbox.add("n3", category: "payroll")
        #expect(try await r.refresh()?.body == "You have 2 new items in Crow HR")
    }

    @Test func turnedOffPostsNothingButTheCursorMoves() async throws {
        let inbox = FakeServerInbox()
        inbox.add("n0", category: "updates")
        let poster = FakePoster()
        let store = MemoryStore()
        _ = try await refresher(inbox, poster, store: store).refresh()
        inbox.add("n1", category: "approvals")
        let off = refresher(inbox, poster, store: store, enabled: false)
        #expect(try await off.refresh() == nil)
        #expect(await off.cursor == "c:2")
        #expect(await poster.posted.isEmpty)
    }

    @Test func emptyInboxAtFirstStillAnnouncesTheFirstItemLater() async throws {
        let inbox = FakeServerInbox()
        let poster = FakePoster()
        let r = refresher(inbox, poster)
        #expect(try await r.refresh() == nil)
        #expect(await r.cursor == InboxRefresher.emptyInbox)
        inbox.add("n1", category: "approvals")
        #expect(try await r.refresh()?.route == .approvals)
        #expect(await r.cursor == "c:1")
    }

    @Test func itemsSeenInTheAppAreNotAnnounced() async throws {
        let inbox = FakeServerInbox()
        inbox.add("n1", category: "approvals")
        let poster = FakePoster()
        let r = refresher(inbox, poster)
        await r.markAllSeen()
        #expect(try await r.refresh() == nil)
    }

    @Test(arguments: [1, 2, 7, 120])
    func noticeTextIsContentFree(_ n: Int) {
        let body = BackgroundRefresh.notificationBody(newItems: n)
        #expect(body.wholeMatch(of: /You have \d+ new items? in Crow HR/) != nil)
    }

    @Test func notificationContentCarriesOnlyTitleBodyAndRoute() async throws {
        let notice = LocalNotice(title: "Crow HR", body: "You have 1 new item in Crow HR", route: .approvals)
        let content = UserNotificationPoster.content(for: notice)
        #expect(content.title == "Crow HR")
        #expect(content.subtitle.isEmpty)
        #expect(content.body == "You have 1 new item in Crow HR")
        #expect(content.attachments.isEmpty)
        #expect(content.userInfo.count == 1)
        #expect(content.userInfo["route"] as? String == "approvals")
    }

    @Test func apiFetcherPagesForwardWithSinceAndPostsNoPersonalData() async throws {
        let stub = StubTransport()
        let item = #"{"id":"0190a0b0-0000-7000-8000-0000000000f2","kind":"task_assigned","category":"approvals","title":"Leave from Ahmad Ismail","body":"3 days annual leave","link":"/approvals","createdAt":"2026-11-07T02:00:00.000Z","readAt":null}"#
        stub.on("GET /api/v1/notifications") { r in
            let since = URLComponents(url: r.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "since" }?.value
            let body = since == "cur-1"
                ? #"{"items":[\#(item)],"page":1,"pageSize":50,"total":1,"unread":1,"cursor":"cur-2"}"#
                : #"{"items":[],"page":1,"pageSize":50,"total":0,"unread":1,"cursor":"cur-2"}"#
            return (200, "application/json", Data(body.utf8))
        }
        let tokens = MemoryTokenStore()
        try tokens.save(TokenSet(accessToken: "a", refreshToken: "r", accessExpiresAt: Date().addingTimeInterval(600), deviceSessionId: "d"), account: "c")
        let api = APIClient(server: testServer, transport: stub, auth: AuthSession(server: testServer, account: "c", store: tokens, transport: stub))
        let store = MemoryStore()
        store.set(Data("cur-1".utf8), forKey: "inbox.cursor.c")
        let r = InboxRefresher(fetcher: APIInboxFetcher(api: api), poster: FakePoster(), store: store, account: "c", enabled: { true })
        let notice = try #require(try await r.refresh())
        #expect(notice == LocalNotice(title: "Crow HR", body: "You have 1 new item in Crow HR", route: .approvals))
        for word in ["Ahmad", "Leave", "annual", "3 days"] {
            #expect(!notice.body.contains(word) && !notice.title.contains(word))
        }
        #expect(await r.cursor == "cur-2")
        let sinces = stub.recorded().map { URLComponents(url: $0.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "since" }?.value }
        #expect(sinces == ["cur-1", "cur-2"]) // paged forward until a page came back empty
    }

    @Test(arguments: [(4.0, false), (5.0, false), (5.1, true), (60.0, true)])
    func appLockAfterMoreThanFiveMinutesInBackground(_ minutes: Double, _ locks: Bool) {
        let now = Date()
        #expect(AppLockPolicy.shouldLock(enabled: true, backgroundedAt: now.addingTimeInterval(-minutes * 60), now: now) == locks)
        #expect(AppLockPolicy.shouldLock(enabled: false, backgroundedAt: now.addingTimeInterval(-minutes * 60), now: now) == false)
    }
}
