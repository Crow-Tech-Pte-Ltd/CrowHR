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

final class FakeInbox: InboxFetching, @unchecked Sendable {
    var items: [InboxItemRef] = []
    func unreadItems() async throws -> [InboxItemRef] { items }
}

/// Task 3.6: BGAppRefreshTask scheduling and a content-free local notification.
@Suite("BackgroundRefresh")
struct BackgroundRefreshTests {
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

    static var root: [String: Any] { Fixtures.json("background-refresh-cases.json") as? [String: Any] ?? [:] }

    @Test func sharedTextsAndInterval() throws {
        let texts = try #require(Self.root["texts"] as? [String: String])
        #expect(BackgroundRefresh.notificationBody(newItems: 1) == texts["one"])
        #expect(BackgroundRefresh.notificationBody(newItems: 4) == texts["many"]?.replacingOccurrences(of: "{count}", with: "4"))
        #expect(BackgroundRefresh.notificationTitle == texts["title"])
        #expect(Double(Self.root["minimumIntervalMinutes"] as? Int ?? 0) * 60 == BackgroundRefresh.minimumInterval)
    }

    @Test func sharedCursorCases() async throws {
        let cases = try #require(Self.root["cases"] as? [[String: Any]])
        #expect(cases.count >= 8)
        for c in cases {
            let id = c["id"] as! String
            let items = (c["items"] as! [[String: Any]]).map {
                InboxItemRef(id: $0["id"] as! String, category: $0["category"] as! String, createdAt: $0["createdAt"] as! String, readAt: $0["readAt"] as? String)
            }
            let expected = c["expected"] as! [String: Any]
            let enabled = c["notificationsEnabled"] as! Bool
            // Through the real refresher, with the cursor stored as on the device.
            let store = MemoryStore()
            if let cursor = c["cursor"] as? String { store.set(Data(cursor.utf8), forKey: "inbox.cursor.conn-1") }
            let inbox = FakeInbox()
            inbox.items = items
            let poster = FakePoster()
            let r = InboxRefresher(fetcher: inbox, poster: poster, store: store, account: "conn-1", enabled: { enabled })
            let notice = try await r.refresh()
            #expect(notice?.body == expected["post"] as? String, "\(id) post")
            #expect(notice?.route.rawValue == expected["opens"] as? String, "\(id) opens")
            #expect(notice.map { $0.title } ?? "Crow HR" == "Crow HR", "\(id) title")
            #expect(await r.cursor == expected["cursor"] as? String, "\(id) cursor")
            #expect(await poster.posted.count == (notice == nil ? 0 : 1), "\(id) posted")
        }
    }

    @Test func itemsSeenInTheAppAreNotAnnounced() async throws {
        let inbox = FakeInbox()
        inbox.items = [InboxItemRef(id: "n1", category: "approvals", createdAt: "2026-11-02T01:00:00.000Z", readAt: nil)]
        let poster = FakePoster()
        let r = InboxRefresher(fetcher: inbox, poster: poster, store: MemoryStore(), account: "c", enabled: { true })
        await r.markAllSeen()
        #expect(try await r.refresh() == nil)
        inbox.items.insert(InboxItemRef(id: "n2", category: "approvals", createdAt: "2026-11-02T02:00:00.000Z", readAt: nil), at: 0)
        #expect(try await r.refresh()?.route == .approvals)
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

    @Test func apiFetcherAsksForUnreadOnlyAndPostsNoPersonalData() async throws {
        let stub = StubTransport()
        let page = #"{"items":[{"id":"n2","kind":"task_assigned","category":"approvals","title":"Leave from Ahmad Ismail","body":"3 days annual leave","link":"/approvals","createdAt":"2026-11-07T02:00:00.000Z","readAt":null}],"page":1,"pageSize":50,"total":1,"unread":1}"#
        stub.onJSON("GET /api/v1/notifications", page)
        let tokens = MemoryTokenStore()
        try tokens.save(TokenSet(accessToken: "a", refreshToken: "r", accessExpiresAt: Date().addingTimeInterval(600), deviceSessionId: "d"), account: "c")
        let api = APIClient(server: testServer, transport: stub, auth: AuthSession(server: testServer, account: "c", store: tokens, transport: stub))
        let store = MemoryStore()
        store.set(Data("2026-11-07T01:00:00.000Z".utf8), forKey: "inbox.cursor.c")
        let r = InboxRefresher(fetcher: APIInboxFetcher(api: api), poster: FakePoster(), store: store, account: "c", enabled: { true })
        let notice = try #require(try await r.refresh())
        #expect(notice == LocalNotice(title: "Crow HR", body: "You have 1 new item in Crow HR", route: .approvals))
        for word in ["Ahmad", "Leave", "annual", "3 days"] {
            #expect(!notice.body.contains(word) && !notice.title.contains(word))
        }
        let q = URLComponents(url: stub.recorded()[0].url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
        #expect(q.contains(URLQueryItem(name: "unread", value: "true")))
        #expect(q.contains(URLQueryItem(name: "sort", value: "-createdAt")))
        #expect(q.contains(URLQueryItem(name: "pageSize", value: "50")))
    }

    @Test(arguments: [(4.0, false), (5.0, false), (5.1, true), (60.0, true)])
    func appLockAfterMoreThanFiveMinutesInBackground(_ minutes: Double, _ locks: Bool) {
        let now = Date()
        #expect(AppLockPolicy.shouldLock(enabled: true, backgroundedAt: now.addingTimeInterval(-minutes * 60), now: now) == locks)
        #expect(AppLockPolicy.shouldLock(enabled: false, backgroundedAt: now.addingTimeInterval(-minutes * 60), now: now) == false)
    }
}
