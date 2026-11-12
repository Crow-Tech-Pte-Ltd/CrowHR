import Foundation
import Testing
@testable import CrowHR

/// My schedule with shift swaps and open-shift pickup (the web's My schedule).
@Suite("Schedule: swaps and open shifts")
struct ScheduleSwapTests {
    static let json = #"""
    {"employeeId":"e1","from":"2026-11-13","to":"2026-11-26",
     "shifts":[
       {"id":"s1","rosterId":"r1","scopeLabel":"HQ","date":"2026-11-17","kind":"shift","start":"09:00","end":"17:00","breakMinutes":60,"paidMinutes":420,"templateCode":"AM","colour":"kuning","note":null,"pendingSwap":false},
       {"id":"s2","rosterId":"r1","scopeLabel":"HQ","date":"2026-11-18","kind":"shift","start":"09:00","end":"17:00","breakMinutes":60,"paidMinutes":420,"templateCode":null,"colour":"plain","note":"Inventory","pendingSwap":true},
       {"id":"s3","rosterId":"r1","scopeLabel":"HQ","date":"2026-11-21","kind":"rest","start":null,"end":null,"breakMinutes":0,"paidMinutes":0,"templateCode":null,"colour":"plain","note":null,"pendingSwap":false}],
     "weeks":[{"weekStart":"2026-11-09","published":false},{"weekStart":"2026-11-16","published":true},{"weekStart":"2026-11-23","published":false}],
     "openShifts":[{"id":"o1","rosterId":"r1","scopeLabel":"HQ","date":"2026-11-20","kind":"shift","start":"07:00","end":"11:00","breakMinutes":0,"paidMinutes":240,"templateCode":null,"colour":"plain","note":null,"pendingSwap":false}],
     "swaps":[
       {"id":"w1","kind":"swap","status":"pending_peer","direction":"incoming","requester":{"id":"e2","name":"Marcus Lim"},"peer":{"id":"e1","name":"Nurul Huda"},
        "shift":{"id":"m1","date":"2026-11-19","time":"13:00–21:00"},"peerShift":{"id":"s1","date":"2026-11-17","time":"09:00–17:00"},"note":"Family dinner","reason":null,"approvalRequestId":null,"createdAt":"2026-11-13T01:00:00.000Z","expiresAt":"2026-11-19T05:00:00.000Z"},
       {"id":"w2","kind":"pickup","status":"pending_approval","direction":"outgoing","requester":{"id":"e1","name":"Nurul Huda"},"peer":null,
        "shift":{"id":"o9","date":"2026-11-20","time":"07:00–11:00"},"peerShift":null,"note":null,"reason":null,"approvalRequestId":"a1","createdAt":"2026-11-13T01:00:00.000Z","expiresAt":"2026-11-20T00:00:00.000Z"},
       {"id":"w3","kind":"giveaway","status":"rejected","direction":"outgoing","requester":{"id":"e1","name":"Nurul Huda"},"peer":{"id":"e2","name":"Marcus Lim"},
        "shift":{"id":"s0","date":"2026-11-16","time":"09:00–17:00"},"peerShift":null,"note":null,"reason":"Marcus would pass 44 hours.","approvalRequestId":"a2","createdAt":"2026-11-12T01:00:00.000Z","expiresAt":"2026-11-16T01:00:00.000Z"}]}
    """#

    private func schedule() throws -> ScheduleMe { try JSONDecoder().decode(ScheduleMe.self, from: Data(Self.json.utf8)) }

    @Test func theScheduleDecodesWithSwapsAndOpenShifts() throws {
        let s = try schedule()
        #expect(s.shifts.count == 3 && s.openShifts.count == 1 && s.swaps.count == 3)
        #expect(s.shifts[0].rosterId == "r1" && s.shifts[1].pendingSwap == true)
        // A server that sends only the shifts still shows them.
        let old = try JSONDecoder().decode(ScheduleMe.self, from: Data(#"{"from":"2026-11-13","to":"2026-11-26","shifts":[{"id":"s1","scopeLabel":"HQ","date":"2026-11-17","kind":"shift","start":"09:00","end":"17:00","breakMinutes":60,"note":null}]}"#.utf8))
        #expect(old.openShifts.isEmpty && old.swaps.isEmpty && old.weeks.isEmpty && old.employeeId == nil)
        let oldWeeks = SwapRules.weeks(old)
        #expect(!oldWeeks.isEmpty && !oldWeeks.contains { !$0.published })
        #expect(!SwapRules.canOffer(old.shifts[0], today: "2026-11-13"), "No roster id: nothing to offer it on")
    }

    @Test func offersRequestsAndStatusesReadAsOnTheWeb() throws {
        let s = try schedule()
        let offers = SwapRules.incomingOffers(s.swaps)
        #expect(offers.map(\.id) == ["w1"])
        #expect(SwapRules.offerText(offers[0]) == "Marcus Lim asks to swap their Thu, 19 Nov 13:00–21:00 for your Tue, 17 Nov 09:00–17:00.")
        let mine = SwapRules.myRequests(s.swaps)
        #expect(mine.map(\.id) == ["w2", "w3"])
        #expect(SwapRules.requestText(mine[0]) == "Pick up Fri, 20 Nov")
        #expect(SwapRules.requestText(mine[1]) == "Give away Mon, 16 Nov with Marcus Lim")
        #expect(SwapRules.status("pending_peer") == ("Waiting for colleague", .warning))
        #expect(SwapRules.status("pending_approval") == ("Waiting for approval", .warning))
        #expect(SwapRules.status("rejected") == ("Not approved", .danger))
        #expect(SwapRules.canCancel(mine[0]) && !SwapRules.canCancel(mine[1]))
        let giveaway = ShiftSwap(id: "g", kind: "giveaway", status: "pending_peer", direction: "incoming", requester: .init(id: "e2", name: "Marcus Lim"),
                                 peer: nil, shift: .init(id: "m1", date: "2026-11-19", time: "13:00–21:00"), peerShift: nil, note: nil, reason: nil)
        #expect(SwapRules.offerText(giveaway) == "Marcus Lim offers you their shift on Thu, 19 Nov 13:00–21:00.")
        let many = (0..<14).map { i in ShiftSwap(id: "x\(i)", kind: "pickup", status: "cancelled", direction: "outgoing", requester: .init(id: "e1", name: "N"),
                                                  peer: nil, shift: .init(id: "o", date: "2026-11-20", time: ""), peerShift: nil, note: nil, reason: nil) }
        #expect(SwapRules.myRequests(many).count == 10)
    }

    @Test func onlyUpcomingShiftsWithoutARequestCanBeOffered() throws {
        let s = try schedule()
        #expect(SwapRules.canOffer(s.shifts[0], today: "2026-11-13"))
        #expect(!SwapRules.canOffer(s.shifts[0], today: "2026-11-18"), "Already past")
        #expect(!SwapRules.canOffer(s.shifts[1], today: "2026-11-13"), "A swap is already asked")
        #expect(!SwapRules.canOffer(s.shifts[2], today: "2026-11-13"), "A rest day")
        #expect(SwapRules.time(s.shifts[0]) == "09:00–17:00")
        #expect(SwapRules.details(s.shifts[0]) == "HQ · 7h paid · 60 min break")
    }

    @Test func unpublishedWeeksSaySoInTheWebsWords() throws {
        let weeks = SwapRules.weeks(try schedule())
        #expect(weeks.map(\.weekStart) == ["2026-11-09", "2026-11-16", "2026-11-23"])
        #expect(weeks.map(\.published) == [false, true, false])
        #expect(weeks[1].days.count == 7 && weeks[0].days == ["2026-11-13", "2026-11-14", "2026-11-15"])
        #expect(SwapRules.unpublishedNotice(weekStart: "2026-11-09", today: "2026-11-13") == "This week's schedule hasn't been published yet.")
        #expect(SwapRules.unpublishedNotice(weekStart: "2026-11-16", today: "2026-11-13") == "Next week's schedule hasn't been published yet.")
        #expect(SwapRules.unpublishedNotice(weekStart: "2026-11-23", today: "2026-11-13") == "The schedule for 23–29 Nov 2026 hasn't been published yet.")
    }

    @Test func aSwapNeedsAColleagueAndTheirShiftAGiveawayOnlyAColleague() throws {
        #expect(SwapRules.request(kind: .swap, shiftID: "s1", peer: "", peerShift: "", note: "") == nil)
        #expect(SwapRules.request(kind: .swap, shiftID: "s1", peer: "e2", peerShift: "", note: "") == nil)
        #expect(SwapRules.request(kind: .swap, shiftID: "s1", peer: "e2", peerShift: "m1", note: "  Family dinner \n")
            == NewSwap(kind: "swap", shiftId: "s1", peerEmployeeId: "e2", peerShiftId: "m1", note: "Family dinner"))
        #expect(SwapRules.request(kind: .giveaway, shiftID: "s1", peer: "e2", peerShift: "m1", note: " ")
            == NewSwap(kind: "giveaway", shiftId: "s1", peerEmployeeId: "e2", peerShiftId: nil, note: nil))
        #expect(SwapRules.request(kind: .giveaway, shiftID: "s1", peer: "e2", peerShift: "", note: String(repeating: "a", count: 250))?.note?.count == 200)
        let pickup = try #require(String(data: JSONEncoder().encode(NewSwap(kind: "pickup", shiftId: "o1")), encoding: .utf8))
        #expect(pickup.contains("\"kind\":\"pickup\"") && !pickup.contains("peerEmployeeId"))
    }

    @Test func colleaguesAndTheirShiftsComeFromTheRoster() throws {
        let json = #"""
        {"roster":{"id":"r1","weekStart":"2026-11-16","locationId":null,"departmentId":null,"scopeLabel":"HQ","status":"published","version":2,"hasChanges":false,"publishedAt":null},
         "mode":"published","canEdit":false,"days":[],
         "employees":[{"id":"e1","name":"Nurul Huda","employeeNumber":"1","schedule":"shift","editable":false,"minutes":0,"restDayAssumed":null,"warnings":[]},
                      {"id":"e2","name":"Marcus Lim","employeeNumber":"2","schedule":"shift","editable":false,"minutes":0,"restDayAssumed":null,"warnings":[]}],
         "shifts":[{"id":"m0","employeeId":"e2","kind":"shift","date":"2026-11-12","start":"13:00","end":"21:00","pendingSwap":false},
                   {"id":"m1","employeeId":"e2","kind":"shift","date":"2026-11-19","start":"13:00","end":"21:00","pendingSwap":false},
                   {"id":"m2","employeeId":"e2","kind":"shift","date":"2026-11-20","start":"13:00","end":"21:00","pendingSwap":true},
                   {"id":"m3","employeeId":"e2","kind":"rest","date":"2026-11-21","start":null,"end":null,"pendingSwap":false},
                   {"id":"o1","employeeId":null,"kind":"shift","date":"2026-11-20","start":"07:00","end":"11:00","pendingSwap":false}],
         "toAcknowledge":[]}
        """#
        let r = try JSONDecoder().decode(RosterWeek.self, from: Data(json.utf8))
        #expect(SwapRules.colleagues(r, me: "e1").map(\.name) == ["Marcus Lim"])
        #expect(SwapRules.theirShifts(r, peer: "e2", today: "2026-11-13").map(\.id) == ["m1"])
    }
}
