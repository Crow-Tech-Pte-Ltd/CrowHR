import Foundation

/// Apply for leave: the parts that depend on the chosen type, the child and the live quote, as in
/// the web form (`apps/web/src/leave/apply-sheet.tsx`). The validation messages are the server's
/// own, from `POST /api/v1/leave/quote` (`issues[].path`), so the app and the web say the same.
enum LeaveForm {
    static let childPlaceholder = "Choose the child"
    /// Shown under the Child field when the employee has no children on record (web: "Add them
    /// under My leave → Children"; the app has no Children screen).
    static let noChildrenHint = "No children recorded yet. Add them in Crow HR on the web, under My leave → Children."

    /// The child to send: only for a type that needs one, and only once one is chosen (the web
    /// sends null otherwise, and the quote then says to choose the child).
    static func childID(type: LeaveType?, chosen: String) -> String? {
        guard type?.needsChild == true, !chosen.isEmpty else { return nil }
        return chosen
    }

    /// The quote's message for one field (`childId`, ...), shown at that field as the web does.
    static func issue(_ path: String, in quote: LeaveQuote?) -> String? {
        quote?.issues.first { $0.path == path }?.message
    }

    /// The quote's other messages, for the summary under "Days counted".
    static func otherIssues(_ quote: LeaveQuote, shownAt fields: Set<String>) -> [LeaveQuote.Issue] {
        quote.issues.filter { !fields.contains($0.path ?? "") }
    }

    /// The fields the form shows issues at, for the chosen type.
    static func fieldsWithIssues(type: LeaveType?) -> Set<String> {
        type?.needsChild == true ? ["childId"] : []
    }

    static func application(type: LeaveType, start: Date, end: Date, sessions: (String, String), childChoice: String) -> LeaveApplication {
        LeaveApplication(leaveTypeId: type.id, startDate: Fmt.day(start), endDate: Fmt.day(max(start, end)),
                         startSession: sessions.0, endSession: sessions.1, childId: childID(type: type, chosen: childChoice))
    }
}

/// Which balances "My leave" lists, and what it calls them (web `routes/_app/leave/index.tsx`).
enum LeaveBalances {
    /// Counted per child: a balance of these without a child is a placeholder the web hides too.
    static let perChildFamily: Set<String> = ["maternity", "paternity", "shared_parental", "adoption"]

    static func shown(_ balances: [LeaveBalance]) -> [LeaveBalance] {
        balances.filter { $0.eligible && !(perChildFamily.contains($0.statutoryCode ?? "") && $0.childId == nil) }
    }

    /// "Paternity leave · Tan Yu Xuan" for a per-child balance; the type's name otherwise.
    static func title(_ b: LeaveBalance, children: [LeaveChild]) -> String {
        guard let id = b.childId else { return b.name }
        return "\(b.name) · \(children.first { $0.id == id }?.name ?? "Child")"
    }
}

/// The team calendar (`GET /api/v1/leave/calendar`), as the web's Leave → Calendar shows it on a
/// phone: two weeks from a Monday, day by day, the days with leave or a public holiday.
enum TeamCalendar {
    static let span = 14

    enum Scope: String, Hashable, Sendable { case team, org }

    struct Day: Equatable, Sendable, Identifiable {
        struct Away: Equatable, Sendable, Hashable {
            let name: String
            let isSelf: Bool
            let entry: LeaveCalendar.Entry
        }
        var id: String { date }
        let date: String
        let holiday: String?
        let away: [Away]
    }

    /// Owners, HR and managers (`leave:read` for all or their team) choose between their team and
    /// "Who's away"; anyone else sees only "Who's away", where sensitive types stay private.
    static func scopes(permissions: [String: [String]]?) -> [(id: Scope, name: String)] {
        let read = permissions?["leave:read"] ?? []
        guard read.contains("all") || read.contains("team") else { return [] }
        return [(.team, read.contains("all") ? "Everyone" : "My team"), (.org, "Who's away")]
    }

    static func defaultScope(permissions: [String: [String]]?) -> Scope {
        scopes(permissions: permissions).isEmpty ? .org : .team
    }

    static func query(from: String, scope: Scope) -> [URLQueryItem] {
        [URLQueryItem(name: "from", value: from), URLQueryItem(name: "to", value: Fmt.addDays(from, span - 1)),
         URLQueryItem(name: "view", value: scope.rawValue)]
    }

    /// Each day from `from` to `to` that has leave or a public holiday, with who is away (in the
    /// server's order of people, then morning before afternoon).
    static func days(_ c: LeaveCalendar) -> [Day] {
        let holidays = Dictionary(c.holidays.map { ($0.date, $0.name) }, uniquingKeysWith: { a, _ in a })
        var out: [Day] = []
        var d = c.from
        var guardDays = 0
        while d <= c.to && guardDays < 62 {
            let away = c.people.flatMap { p in
                p.entries.filter { $0.date == d }.sorted { order($0.session) < order($1.session) }
                    .map { Day.Away(name: p.name, isSelf: p.isSelf, entry: $0) }
            }
            if !away.isEmpty || holidays[d] != nil { out.append(Day(date: d, holiday: holidays[d], away: away)) }
            d = Fmt.addDays(d, 1)
            guardDays += 1
        }
        return out
    }

    private static func order(_ session: String) -> Int { session == "pm" ? 2 : session == "am" ? 1 : 0 }

    /// "Morning", "Afternoon" or nil for a full day.
    static func half(_ session: String) -> String? {
        session == "am" ? "Morning" : session == "pm" ? "Afternoon" : nil
    }

    /// What VoiceOver reads for one person on one day: "Nurul Huda (you), Annual leave, morning,
    /// pending".
    static func spoken(_ a: Day.Away) -> String {
        [a.name + (a.isSelf ? " (you)" : ""), a.entry.label, half(a.entry.session)?.lowercased(), a.entry.status == "pending" ? "pending" : nil]
            .compactMap { $0 }.joined(separator: ", ")
    }
}
