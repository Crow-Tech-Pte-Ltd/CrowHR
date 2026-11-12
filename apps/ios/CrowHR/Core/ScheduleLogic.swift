import Foundation

/// My schedule with shift swaps and open-shift pickup, as on the web's My schedule
/// (`apps/web/src/routes/_app/schedules/me.tsx`): offers waiting for an answer, the next 14 days
/// with Swap on each upcoming shift, the open shifts to pick up, and my requests with their status.
enum SwapRules {
    enum Kind: String, Hashable, Sendable { case swap, giveaway, pickup }

    /// The web's labels and tones (`SWAP_STATUS`).
    static func status(_ s: String) -> (String, Tone) {
        switch s {
        case "pending_peer": ("Waiting for colleague", .warning)
        case "pending_approval": ("Waiting for approval", .warning)
        case "approved": ("Approved", .success)
        case "rejected": ("Not approved", .danger)
        case "declined": ("Declined", .neutral)
        case "cancelled": ("Cancelled", .neutral)
        case "expired": ("Expired", .neutral)
        default: (s.replacingOccurrences(of: "_", with: " ").capitalized, .neutral)
        }
    }

    /// Offers from colleagues waiting for this person's answer.
    static func incomingOffers(_ swaps: [ShiftSwap]) -> [ShiftSwap] {
        swaps.filter { $0.direction == "incoming" && $0.status == "pending_peer" }
    }

    /// This person's own requests, newest first (the server's order), at most ten.
    static func myRequests(_ swaps: [ShiftSwap]) -> [ShiftSwap] {
        Array(swaps.filter { $0.direction == "outgoing" }.prefix(10))
    }

    static func canCancel(_ s: ShiftSwap) -> Bool { s.status == "pending_peer" || s.status == "pending_approval" }

    /// A shift that can still be offered: a working shift from today on, on a roster, with no
    /// request open for it.
    static func canOffer(_ shift: ScheduleMe.Shift, today: String) -> Bool {
        shift.kind == "shift" && shift.date >= today && shift.pendingSwap != true && shift.rosterId != nil
    }

    /// "Marcus Lim asks to swap their Tue, 17 Nov 09:00–17:00 for your Thu, 19 Nov 13:00–21:00."
    static func offerText(_ s: ShiftSwap) -> String {
        let theirs = "\(day(s.shift.date)) \(s.shift.time)"
        if s.kind == "swap", let mine = s.peerShift {
            return "\(s.requester.name) asks to swap their \(theirs) for your \(day(mine.date)) \(mine.time)."
        }
        return "\(s.requester.name) offers you their shift on \(theirs)."
    }

    /// "Swap Tue, 17 Nov with Marcus Lim", "Pick up Fri, 20 Nov", "Give away Wed, 18 Nov with …".
    static func requestText(_ s: ShiftSwap) -> String {
        let verb = s.kind == "pickup" ? "Pick up" : s.kind == "swap" ? "Swap" : "Give away"
        return "\(verb) \(day(s.shift.date))" + (s.peer.map { " with \($0.name)" } ?? "")
    }

    /// What the colleague is told, shown after a request is sent or answered (the web's toasts).
    static func doneMessage(_ action: String) -> String {
        switch action {
        case "accept": "Accepted. Your manager will approve it."
        case "decline": "Declined."
        case "cancel": "Request cancelled."
        case "pickup": "Asked. Your manager will approve it."
        default: "Sent. Your colleague accepts first, then your manager approves."
        }
    }

    /// Colleagues on the shift's roster (not this person).
    static func colleagues(_ roster: RosterWeek, me: String?) -> [RosterWeek.Employee] {
        roster.employees.filter { $0.id != me }
    }

    /// The colleague's upcoming working shifts on that roster that aren't already in a request.
    static func theirShifts(_ roster: RosterWeek, peer: String, today: String) -> [RosterWeek.Shift] {
        roster.shifts.filter { $0.employeeId == peer && $0.kind == "shift" && $0.date >= today && $0.pendingSwap != true }
    }

    /// The request to send, or nil while something is missing (a colleague; for a swap, their
    /// shift). A note is trimmed, at most 200 characters, and left out when empty.
    static func request(kind: Kind, shiftID: String, peer: String, peerShift: String, note: String) -> NewSwap? {
        guard kind != .pickup, !peer.isEmpty, kind == .giveaway || !peerShift.isEmpty else { return nil }
        let trimmed = String(note.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
        return NewSwap(kind: kind.rawValue, shiftId: shiftID, peerEmployeeId: peer, peerShiftId: kind == .swap ? peerShift : nil,
                       note: trimmed.isEmpty ? nil : trimmed)
    }

    /// The days of the schedule's range by week: a published week lists its days, an unpublished
    /// one says so (the web's wording).
    struct Week: Equatable, Sendable, Identifiable {
        var id: String { weekStart }
        let weekStart: String
        let published: Bool
        let days: [String]
    }

    static func weeks(_ s: ScheduleMe) -> [Week] {
        var days: [String] = []
        var d = s.from
        while d <= s.to && days.count < 62 {
            days.append(d)
            d = Fmt.addDays(d, 1)
        }
        let published = Dictionary(s.weeks.map { ($0.weekStart, $0.published) }, uniquingKeysWith: { a, _ in a })
        var out: [Week] = []
        for day in days {
            let monday = Fmt.mondayOf(day)
            if let i = out.firstIndex(where: { $0.weekStart == monday }) {
                out[i] = Week(weekStart: monday, published: out[i].published, days: out[i].days + [day])
            } else {
                // A server without `weeks` (older) counts every week with shifts as published.
                let isPublished = published[monday] ?? (s.weeks.isEmpty)
                out.append(Week(weekStart: monday, published: isPublished, days: [day]))
            }
        }
        return out
    }

    static func unpublishedNotice(weekStart: String, today: String) -> String {
        let thisWeek = Fmt.mondayOf(today)
        if weekStart == thisWeek { return "This week's schedule hasn't been published yet." }
        if weekStart == Fmt.addDays(thisWeek, 7) { return "Next week's schedule hasn't been published yet." }
        return "The schedule for \(Fmt.dateRange(weekStart, Fmt.addDays(weekStart, 6))) hasn't been published yet."
    }

    /// "09:00–17:00".
    static func time(_ shift: ScheduleMe.Shift) -> String { "\(shift.start ?? "")–\(shift.end ?? "")" }

    /// "HQ · 7h paid · 60 min break".
    static func details(_ shift: ScheduleMe.Shift) -> String {
        var parts = [shift.scopeLabel]
        if let paid = shift.paidMinutes { parts.append("\(Fmt.hoursMinutes(Int(paid))) paid") }
        if shift.breakMinutes > 0 { parts.append("\(Int(shift.breakMinutes)) min break") }
        return parts.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private static func day(_ s: String) -> String { Fmt.parseDay(s).map(Fmt.dayShort) ?? s }
}
