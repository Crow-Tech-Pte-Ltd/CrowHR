import Foundation
import Testing
@testable import CrowHR

/// Leave types that need a child (as the web form picks the child, with the server's messages)
/// and the team calendar.
@Suite("Leave: children and the team calendar")
struct LeaveFormTests {
    private func type(needsChild: Bool, code: String = "infant_care") -> LeaveType {
        LeaveType(id: "t-\(code)", code: code, name: needsChild ? "Unpaid infant care leave" : "Annual leave", halfDays: true,
                  attachment: "none", attachmentLabel: nil, needsChild: needsChild, archived: false)
    }

    @Test func theChildIsSentOnlyForATypeThatNeedsOne() throws {
        #expect(LeaveForm.childID(type: type(needsChild: false), chosen: "kid-1") == nil)
        #expect(LeaveForm.childID(type: type(needsChild: true), chosen: "") == nil)
        #expect(LeaveForm.childID(type: type(needsChild: true), chosen: "kid-1") == "kid-1")
        let day = try #require(Fmt.parseDay("2026-11-16"))
        let annual = LeaveForm.application(type: type(needsChild: false), start: day, end: day, sessions: ("full", "full"), childChoice: "kid-1")
        let json = try #require(String(data: JSONEncoder().encode(annual), encoding: .utf8))
        #expect(!json.contains("childId"), "A type without a child sends none: \(json)")
        let infant = LeaveForm.application(type: type(needsChild: true), start: day, end: day, sessions: ("am", "am"), childChoice: "kid-1")
        #expect(infant.childId == "kid-1" && infant.startSession == "am" && infant.startDate == "2026-11-16")
    }

    /// The server's own messages (`issues[].path`): the child's under the Child field, the rest
    /// under "Days counted".
    @Test func theQuotesChildMessageShowsAtTheField() throws {
        let json = #"""
        {"employeeId":"e","type":{"id":"t"},"unit":"days","quantity":1,"days":[],"years":[],
         "issues":[{"code":"child_required","path":"childId","message":"Unpaid infant care leave is per child. Choose the child (add them under Children first)."},
                   {"code":"overlap","path":"startDate","message":"You already have leave on 16 Nov 2026."}],
         "warnings":[],"ok":false}
        """#
        let q = try JSONDecoder().decode(LeaveQuote.self, from: Data(json.utf8))
        #expect(LeaveForm.issue("childId", in: q) == "Unpaid infant care leave is per child. Choose the child (add them under Children first).")
        #expect(LeaveForm.otherIssues(q, shownAt: LeaveForm.fieldsWithIssues(type: type(needsChild: true))).map(\.path) == ["startDate"])
        #expect(LeaveForm.otherIssues(q, shownAt: LeaveForm.fieldsWithIssues(type: type(needsChild: false))).count == 2)
        // Older replies without `path` still decode.
        let old = try JSONDecoder().decode(LeaveQuote.Issue.self, from: Data(#"{"code":"x","message":"y"}"#.utf8))
        #expect(old.path == nil)
    }

    @Test func perChildBalancesAreNamedAndPlaceholdersHidden() throws {
        func b(_ code: String, child: String?, eligible: Bool = true) -> LeaveBalance {
            LeaveBalance(typeId: code, code: code, name: code == "paternity" ? "Paternity leave" : "Annual leave", unit: "days", tracked: true,
                         eligible: eligible, childId: child, entitlement: 10, taken: 0, pending: 0, available: 10, statutoryCode: code)
        }
        let shown = LeaveBalances.shown([b("annual", child: nil), b("paternity", child: nil), b("paternity", child: "k1"), b("annual", child: nil, eligible: false)])
        #expect(shown.map(\.id) == ["annual", "paternityk1"])
        let kids = [LeaveChild(id: "k1", name: "Tan Yu Xuan")]
        #expect(LeaveBalances.title(shown[1], children: kids) == "Paternity leave · Tan Yu Xuan")
        #expect(LeaveBalances.title(shown[1], children: []) == "Paternity leave · Child")
        #expect(LeaveBalances.title(shown[0], children: kids) == "Annual leave")
    }

    @Test func calendarScopesFollowTheLeaveReadPermission() {
        #expect(TeamCalendar.scopes(permissions: nil).isEmpty)
        #expect(TeamCalendar.scopes(permissions: ["leave:read": ["own"]]).isEmpty)
        #expect(TeamCalendar.defaultScope(permissions: ["leave:read": ["own"]]) == .org)
        let manager = TeamCalendar.scopes(permissions: ["leave:read": ["own", "team"]])
        #expect(manager.map(\.id) == [.team, .org] && manager.map(\.name) == ["My team", "Who's away"])
        #expect(TeamCalendar.scopes(permissions: ["leave:read": ["all"]]).first?.name == "Everyone")
        #expect(TeamCalendar.defaultScope(permissions: ["leave:read": ["team"]]) == .team)
        let q = TeamCalendar.query(from: "2026-11-09", scope: .team)
        #expect(q.map(\.value) == ["2026-11-09", "2026-11-22", "team"])
    }

    @Test func theCalendarListsDaysWithLeaveOrAHoliday() throws {
        let json = #"""
        {"from":"2026-11-09","to":"2026-11-22","holidays":[{"date":"2026-11-09","name":"Deepavali"}],
         "people":[
          {"employeeId":"e1","name":"Nurul Huda","self":true,"entries":[
            {"date":"2026-11-17","session":"pm","status":"pending","label":"Annual leave","typeCode":"annual","requestId":"r2"},
            {"date":"2026-11-17","session":"am","status":"approved","label":"Annual leave","typeCode":"annual","requestId":"r1"}]},
          {"employeeId":"e2","name":"Marcus Lim","self":false,"entries":[
            {"date":"2026-11-17","session":"full","status":"approved","label":"Away","typeCode":null,"requestId":null}]}]}
        """#
        let cal = try JSONDecoder().decode(LeaveCalendar.self, from: Data(json.utf8))
        #expect(cal.people.first?.isSelf == true)
        let days = TeamCalendar.days(cal)
        #expect(days.map(\.date) == ["2026-11-09", "2026-11-17"])
        #expect(days[0].holiday == "Deepavali" && days[0].away.isEmpty)
        #expect(days[1].away.map(\.entry.session) == ["am", "pm", "full"])
        #expect(TeamCalendar.spoken(days[1].away[1]) == "Nurul Huda (you), Annual leave, afternoon, pending")
        #expect(TeamCalendar.spoken(days[1].away[2]) == "Marcus Lim, Away")
    }

    @Test func dateRangesAndWeeks() {
        #expect(Fmt.dateRange("2026-11-09", "2026-11-22") == "9–22 Nov 2026")
        #expect(Fmt.dateRange("2026-11-30", "2026-12-13") == "30 Nov – 13 Dec 2026")
        #expect(Fmt.dateRange("2026-12-28", "2027-01-10") == "28 Dec 2026 – 10 Jan 2027")
        #expect(Fmt.dateRange("2026-11-13", "2026-11-13") == "13 Nov 2026")
        #expect(Fmt.mondayOf("2026-11-13") == "2026-11-09") // a Friday
        #expect(Fmt.mondayOf("2026-11-15") == "2026-11-09") // a Sunday
        #expect(Fmt.mondayOf("2026-11-16") == "2026-11-16")
        #expect(Fmt.addDays("2026-11-30", 1) == "2026-12-01")
        #expect(Fmt.addDays("2027-01-01", -1) == "2026-12-31")
        #expect(Fmt.weekday("2026-11-16") == "Mon")
        #expect(Fmt.hoursMinutes(450) == "7h 30m" && Fmt.hoursMinutes(480) == "8h" && Fmt.hoursMinutes(45) == "45m")
    }

    @MainActor
    @Test func aLeaveRequestDecodesForItsSheet() throws {
        let json = #"""
        {"id":"r1","employee":{"id":"e1","name":"Marcus Lim"},"type":{"id":"t","code":"infant_care","name":"Unpaid infant care leave"},
         "startDate":"2026-11-16","endDate":"2026-11-16","startSession":"am","endSession":"am","unit":"days","quantity":0.5,"reason":null,
         "status":"pending","child":{"id":"k1","name":"Lim Kai"},"attachments":[],"approvalRequestId":"a1","cancellationRequestId":null,
         "onBehalf":false,"cancelReason":null,"createdAt":"2026-11-13T02:00:00.000Z","decidedAt":null,"days":[{"date":"2026-11-16","session":"am","quantity":0.5}]}
        """#
        let r = try JSONDecoder().decode(LeaveRequestDetail.self, from: Data(json.utf8))
        #expect(r.child?.name == "Lim Kai")
        #expect(r.row.statusLabel == ("Pending", .warning))
        #expect(LeaveRequestSheet.dates(r) == "16 Nov 2026 (morning)")
        #expect(LeaveRequestRow.quantity(r.quantity, unit: r.unit) == "0.5 days")
    }
}
