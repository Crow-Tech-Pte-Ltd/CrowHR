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

/// A notifications endpoint with (`hasCursor`) or without the opaque server cursor. With a cursor,
/// "c:<n>" means "after the first n items in creation order".
final class FakeServerInbox: InboxFetching, @unchecked Sendable {
    private let lock = NSLock()
    private var items: [InboxItemRef] = []
    private var calls: [InboxRequest] = []
    let hasCursor: Bool

    init(hasCursor: Bool = true) { self.hasCursor = hasCursor }

    func add(_ id: String, category: String, read: Bool = false) {
        lock.withLock {
            items.append(InboxItemRef(id: id, category: category, createdAt: "2026-11-07T0\(items.count % 10):00:00.000Z", readAt: read ? "2026-11-07T09:00:00.000Z" : nil))
        }
    }

    func set(_ list: [InboxItemRef]) { lock.withLock { items = list } }
    func recordedCalls() -> [InboxRequest] { lock.withLock { calls } }

    func fetch(_ request: InboxRequest) async throws -> InboxPage {
        lock.withLock {
            calls.append(request)
            let cursor = hasCursor ? (items.isEmpty ? nil : "c:\(items.count)") : nil
            switch request {
            case .latest(let size):
                return InboxPage(items: Array(items.reversed().prefix(size)), cursor: cursor, serverHasCursor: hasCursor)
            case .unreadNewest:
                // Returned as the fixture gives them (a read item can still appear in the response).
                return InboxPage(items: items.sorted { $0.createdAt > $1.createdAt }, cursor: cursor, serverHasCursor: hasCursor)
            case .since(let since):
                let n = Int(since.dropFirst(2)) ?? 0
                return InboxPage(items: Array(items.dropFirst(n)), cursor: "c:\(max(items.count, n))", serverHasCursor: true)
            }
        }
    }
}

/// Task 3.6: BGAppRefreshTask scheduling and a content-free local notification, with the shared
/// rules in apps/mobile-fixtures/background-refresh-cases.json.
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
        #expect(Self.root["serverCursor"] != nil)
    }

    /// The shared createdAt cases: the rule for older servers whose response has no `cursor`,
    /// run through the real refresher.
    @Test func sharedCreatedAtCasesOnAServerWithoutCursor() async throws {
        let cases = try #require(Self.root["cases"] as? [[String: Any]])
        #expect(cases.count >= 8)
        for c in cases {
            let id = c["id"] as! String
            let items = (c["items"] as! [[String: Any]]).map {
                InboxItemRef(id: $0["id"] as! String, category: $0["category"] as! String, createdAt: $0["createdAt"] as! String, readAt: $0["readAt"] as? String)
            }
            let expected = c["expected"] as! [String: Any]
            let enabled = c["notificationsEnabled"] as! Bool
            let store = MemoryStore()
            if let cursor = c["cursor"] as? String { store.set(Data(cursor.utf8), forKey: "inbox.cursor.conn-1") }
            let inbox = FakeServerInbox(hasCursor: false)
            inbox.set(items)
            let poster = FakePoster()
            let r = InboxRefresher(fetcher: inbox, poster: poster, store: store, account: "conn-1", enabled: { enabled })
            let notice = try await r.refresh()
            #expect(notice?.body == expected["post"] as? String, "\(id) post")
            #expect(notice?.route.rawValue == expected["opens"] as? String, "\(id) opens")
            #expect(await r.cursor == expected["cursor"] as? String, "\(id) cursor")
            #expect(await poster.posted.count == (notice == nil ? 0 : 1), "\(id) posted")
        }
    }

    // MARK: Server cursor (serverCursor rules in the shared fixture)

    private func refresher(_ inbox: FakeServerInbox, _ poster: FakePoster, store: MemoryStore = MemoryStore(), enabled: Bool = true) -> InboxRefresher {
        InboxRefresher(fetcher: inbox, poster: poster, store: store, account: "conn-1", enabled: { enabled })
    }

    @Test func firstRefreshReadsOneItemStoresTheCursorAndPostsNothing() async throws {
        let inbox = FakeServerInbox()
        inbox.add("n1", category: "approvals")
        let poster = FakePoster()
        let r = refresher(inbox, poster)
        #expect(try await r.refresh() == nil)
        #expect(inbox.recordedCalls() == [.latest(pageSize: 1)])
        #expect(await r.cursor == "srv:c:1")
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
        #expect(inbox.recordedCalls() == [.latest(pageSize: 1), .since("c:1")])
        #expect(await r.cursor == "srv:c:2")
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
        #expect(await off.cursor == "srv:c:2")
        #expect(await poster.posted.isEmpty)
    }

    @Test func emptyInboxAtFirstStillAnnouncesTheFirstItemLater() async throws {
        let inbox = FakeServerInbox()
        let poster = FakePoster()
        let r = refresher(inbox, poster)
        #expect(try await r.refresh() == nil)
        #expect(await r.cursor == "srv:")
        inbox.add("n1", category: "approvals")
        #expect(try await r.refresh()?.route == .approvals)
        #expect(await r.cursor == "srv:c:1")
    }

    @Test func openingTheInboxStoresThatListsCursor() async throws {
        let inbox = FakeServerInbox()
        inbox.add("n1", category: "approvals")
        inbox.add("n2", category: "approvals")
        let poster = FakePoster()
        let r = refresher(inbox, poster)
        await r.markAllSeen(listCursor: "c:2", listHadCursor: true)
        #expect(inbox.recordedCalls().isEmpty) // no extra request
        #expect(try await r.refresh() == nil)
    }

    @Test func openingAnEmptyInboxOnACursorServerNeedsNoExtraRequest() async throws {
        // The list answered `"cursor": null`: the server has cursors and nothing to point at yet.
        let page = try JSONDecoder().decode(NotificationPage.self, from: Data(#"{"items":[],"total":0,"unread":0,"cursor":null}"#.utf8))
        #expect(page.hasCursor && page.cursor == nil)
        let older = try JSONDecoder().decode(NotificationPage.self, from: Data(#"{"items":[],"total":0,"unread":0}"#.utf8))
        #expect(!older.hasCursor)
        let inbox = FakeServerInbox()
        let r = refresher(inbox, FakePoster())
        await r.markAllSeen(listCursor: page.cursor, listHadCursor: page.hasCursor)
        #expect(inbox.recordedCalls().isEmpty)
        // As before: "srv:" with nothing after it, so the next refresh counts everything new.
        #expect(await r.cursor == "srv:")
        inbox.add("n1", category: "updates")
        #expect(try await r.refresh()?.route == .notifications)
    }

    @Test func markingOneNotificationReadUpdatesThePageInPlace() throws {
        let json = #"""
        {"items":[{"id":"n1","kind":"k","category":"updates","title":"A","body":null,"createdAt":"2026-11-07T01:00:00.000Z","readAt":null},
                  {"id":"n2","kind":"k","category":"updates","title":"B","body":null,"createdAt":"2026-11-07T00:00:00.000Z","readAt":"2026-11-07T02:00:00.000Z"}],
         "total":2,"unread":1,"cursor":"c:2"}
        """#
        let page = try JSONDecoder().decode(NotificationPage.self, from: Data(json.utf8))
        let read = page.markingRead("n1", at: "2026-11-07T03:00:00.000Z")
        #expect(read.items.map(\.readAt) == ["2026-11-07T03:00:00.000Z", "2026-11-07T02:00:00.000Z"])
        #expect(read.unread == 0)
        // Already read, or not on the page: nothing changes.
        #expect(read.markingRead("n2", at: "x").unread == 0)
        #expect(read.markingRead("n9", at: "x").items == read.items)
    }

    @Test func upgradedServerSwitchesFromCreatedAtToItsCursor() async throws {
        let store = MemoryStore()
        store.set(Data("2026-11-07T00:00:00.000Z".utf8), forKey: "inbox.cursor.conn-1")
        let inbox = FakeServerInbox(hasCursor: true)
        inbox.add("n0", category: "updates") // 00:00, already seen
        inbox.add("n1", category: "approvals") // 01:00, new
        let r = refresher(inbox, FakePoster(), store: store)
        #expect(try await r.refresh()?.route == .approvals)
        #expect(await r.cursor == "srv:c:2")
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
        store.set(Data("srv:cur-1".utf8), forKey: "inbox.cursor.c")
        let r = InboxRefresher(fetcher: APIInboxFetcher(api: api), poster: FakePoster(), store: store, account: "c", enabled: { true })
        let notice = try #require(try await r.refresh())
        #expect(notice == LocalNotice(title: "Crow HR", body: "You have 1 new item in Crow HR", route: .approvals))
        for word in ["Ahmad", "Leave", "annual", "3 days"] {
            #expect(!notice.body.contains(word) && !notice.title.contains(word))
        }
        #expect(await r.cursor == "srv:cur-2")
        let sinces = stub.recorded().map { URLComponents(url: $0.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "since" }?.value }
        #expect(sinces == ["cur-1", "cur-2"]) // paged forward until a page came back empty
    }

    @Test func apiFetcherTellsAnOldServerWithoutCursorApart() async throws {
        let stub = StubTransport()
        stub.onJSON("GET /api/v1/notifications", #"{"items":[],"page":1,"pageSize":1,"total":0,"unread":0}"#)
        let api = APIClient(server: testServer, transport: stub, auth: nil)
        let page = try await APIInboxFetcher(api: api).fetch(.latest(pageSize: 1))
        #expect(page.serverHasCursor == false)
        stub.onJSON("GET /api/v1/notifications", #"{"items":[],"page":1,"pageSize":1,"total":0,"unread":0,"cursor":null}"#)
        #expect(try await APIInboxFetcher(api: api).fetch(.latest(pageSize: 1)).serverHasCursor == true)
    }

    @Test(arguments: [(4.0, false), (5.0, false), (5.1, true), (60.0, true)])
    func appLockAfterMoreThanFiveMinutesInBackground(_ minutes: Double, _ locks: Bool) {
        let now = Date()
        #expect(AppLockPolicy.shouldLock(enabled: true, backgroundedAt: now.addingTimeInterval(-minutes * 60), now: now) == locks)
        #expect(AppLockPolicy.shouldLock(enabled: false, backgroundedAt: now.addingTimeInterval(-minutes * 60), now: now) == false)
    }

    @Test func appLockOnAColdStartAndWhenTheClockWentBack() {
        let now = Date()
        #expect(AppLockPolicy.shouldLock(enabled: true, unlockedThisLaunch: false, backgroundedAt: nil, now: now))
        #expect(AppLockPolicy.shouldLock(enabled: false, unlockedThisLaunch: false, backgroundedAt: nil, now: now) == false)
        #expect(AppLockPolicy.shouldLock(enabled: true, backgroundedAt: nil, now: now) == false)
        // Setting the clock back while the app is away must not skip the lock.
        #expect(AppLockPolicy.shouldLock(enabled: true, backgroundedAt: now.addingTimeInterval(3_600), now: now))
    }
}
