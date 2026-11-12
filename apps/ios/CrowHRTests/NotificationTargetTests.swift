import Foundation
import Testing
import UserNotifications
@testable import CrowHR

/// Tapping a notification opens the item it is about (apps/mobile-fixtures/
/// notification-link-cases.json), and the inbox badge's count.
@Suite("Notification targets")
struct NotificationTargetTests {
    static var root: [String: Any] { Fixtures.json("notification-link-cases.json") as? [String: Any] ?? [:] }

    /// The screen both apps open (and, for claims and payslips, the item on it).
    @Test func linksOpenTheirScreen() throws {
        let cases = try #require(Self.root["cases"] as? [[String: Any]])
        #expect(cases.count >= 20)
        for c in cases {
            let t = AppTarget.from(link: c["link"] as? String)
            #expect(t.opens == c["opens"] as? String, "\(c)")
            #expect(t.opensID == c["id"] as? String, "\(c)")
        }
    }

    /// What iOS also opens inside the screen: the approval task, the request's task, the leave request.
    @Test func linksOpenTheirItemInsideTheScreen() throws {
        let items = try #require(Self.root["items"] as? [[String: Any]])
        for c in items {
            let t = AppTarget.from(link: c["link"] as? String)
            #expect(t.kind == c["item"] as? String, "\(c)")
            #expect(t.id == c["id"] as? String, "\(c)")
        }
        #expect(AppTarget.from(link: "/claims/admin") == .notifications)
        #expect(AppTarget.from(link: " /claims ") == .claims)
        #expect(AppTarget.from(link: "/claims/\(String(repeating: "a", count: 65))") == .notifications)
    }

    @Test func everyTargetHasItsTab() {
        #expect(AppTarget.approvalTask("x").tab == .inbox)
        #expect(AppTarget.notifications.tab == .inbox)
        #expect(AppTarget.leaveCalendar.tab == .leave)
        #expect(AppTarget.claim("x").tab == .claims)
        #expect(AppTarget.payslip("x").tab == .pay)
        #expect(AppTarget.schedule.tab == .schedule)
        #expect(AppTarget.profile.tab == .profile)
        #expect(AppTarget.clock.tab == .today)
    }

    /// The local notification for one new item carries that item's link and id (not in its text),
    /// and its tap opens the item; several open the inbox as before.
    @Test func theLocalNotificationOpensTheItemItAnnounces() throws {
        let cases = try #require(Self.root["localNotification"] as? [[String: Any]])
        for c in cases {
            let id = c["id"] as! String
            let fresh = (c["fresh"] as! [[String: Any]]).map {
                InboxItemRef(id: $0["id"] as! String, category: $0["category"] as! String, createdAt: "2026-11-13T02:00:00.000Z",
                             readAt: $0["readAt"] as? String, link: $0["link"] as? String)
            }
            let expected = c["expected"] as! [String: Any]
            let notice = try #require(InboxCursor.notice(for: fresh, notificationsEnabled: true), "\(id)")
            #expect(notice.route.rawValue == expected["route"] as? String, "\(id) route")
            #expect(notice.link == expected["link"] as? String, "\(id) link")
            #expect(notice.notificationID == expected["notificationId"] as? String, "\(id) notification id")
            #expect((notice.target.opens ?? "notifications") == expected["opens"] as? String, "\(id) opens")
            // The text holds only the count, whatever it links to.
            #expect(notice.body == BackgroundRefresh.notificationBody(newItems: fresh.filter { $0.readAt == nil }.count), "\(id) text")
            // Round trip through the posted notification's userInfo, as a tap delivers it.
            let content = UserNotificationPoster.content(for: notice)
            #expect(!content.body.contains("leave") && !content.body.contains("/"), "\(id): no link in the text")
            let tapped = LocalNotice.tapped(userInfo: content.userInfo)
            #expect(tapped.target == notice.target, "\(id) tapped")
            #expect(tapped.notificationID == notice.notificationID, "\(id) marks read")
        }
    }

    @Test func aTapFromAnOlderBuildStillOpensTheInbox() {
        #expect(LocalNotice.tapped(userInfo: ["route": "approvals"]).target == .approvals)
        #expect(LocalNotice.tapped(userInfo: ["route": "notifications"]).target == .notifications)
        #expect(LocalNotice.tapped(userInfo: [:]).target == .notifications)
        // A link the app has no screen for (or one to elsewhere) opens the inbox it was posted for.
        #expect(LocalNotice.tapped(userInfo: ["route": "approvals", "link": "https://evil.example/x"]).target == .approvals)
        #expect(LocalNotice.tapped(userInfo: ["route": "notifications", "link": "/payroll/runs/r1"]).target == .notifications)
    }

    @Test func approvalsOpenTheTaskANotificationIsAbout() {
        let task = ApprovalTask(taskId: "t1", requestId: "r1", subjectType: "leave", subjectLabel: "Leave", title: "Annual leave",
                                requester: .init(name: "Nurul Huda"), submittedAt: "2026-11-13T01:00:00.000Z", dueOn: nil, overdueDays: 0,
                                step: .init(position: 1, of: 1, label: "Manager"))
        #expect(ApprovalsAccess.task(for: .approvalTask("t1"), in: [task])?.taskId == "t1")
        #expect(ApprovalsAccess.task(for: .approvalRequest("r1"), in: [task])?.taskId == "t1")
        #expect(ApprovalsAccess.task(for: .approvalTask("t9"), in: [task]) == nil)
        #expect(ApprovalsAccess.task(for: .approvals, in: [task]) == nil)
    }

    @Test func notificationsDecodeTheirLinkAndTheUnreadCount() throws {
        let json = #"""
        {"items":[{"id":"n1","kind":"request_approved","category":"requests","title":"Your leave was approved","body":null,"link":"/leave?request=0190a0b0-0000-7000-8000-0000000000b1","createdAt":"2026-11-13T02:00:00.000Z","readAt":null}],
         "page":1,"pageSize":50,"total":1,"unread":1,"cursor":"c1"}
        """#
        let page = try JSONDecoder().decode(NotificationPage.self, from: Data(json.utf8))
        #expect(AppTarget.from(link: page.items[0].link) == .leaveRequest("0190a0b0-0000-7000-8000-0000000000b1"))
        #expect(page.unread == 1)
        #expect(try JSONDecoder().decode(UnreadCount.self, from: Data(#"{"unread":3}"#.utf8)).unread == 3)
    }

    /// With several field problems the server's message only counts them: each one follows.
    @Test func serverErrorsListEachProblem() {
        let several = #"{"error":{"code":"validation_failed","message":"Fix 2 problems before submitting.","requestId":"x","details":{"issues":[{"path":"lines.0.receiptIds","message":"Line 1: Meals needs a receipt above S$10.00. Attach a photo or PDF."},{"path":"lines.1.merchant","message":"Line 2: enter where you spent it (merchant)."}]}}}"#
        #expect(decodeServerError(status: 400, data: Data(several.utf8)).message
            == "Fix 2 problems before submitting.\nLine 1: Meals needs a receipt above S$10.00. Attach a photo or PDF.\nLine 2: enter where you spent it (merchant).")
        let one = #"{"error":{"code":"validation_failed","message":"Line 1: enter where you spent it (merchant).","requestId":"x","details":{"issues":[{"path":"lines.0.merchant","message":"Line 1: enter where you spent it (merchant)."}]}}}"#
        #expect(decodeServerError(status: 400, data: Data(one.utf8)).message == "Line 1: enter where you spent it (merchant).")
        // Other errors' details have other shapes: the message is kept as it is.
        let decided = #"{"error":{"code":"already_decided","message":"Already decided by Tan Mei Ling.","requestId":"x","details":{"decidedBy":"Tan Mei Ling"}}}"#
        #expect(decodeServerError(status: 409, data: Data(decided.utf8)) == .server(status: 409, code: "already_decided", message: "Already decided by Tan Mei Ling."))
        let list = #"{"error":{"code":"conflict","message":"Acknowledge them.","requestId":"x","details":[1,2]}}"#
        #expect(decodeServerError(status: 409, data: Data(list.utf8)).message == "Acknowledge them.")
    }
}
