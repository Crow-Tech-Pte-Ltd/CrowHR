import Foundation

/// Where the app goes for a notification: the item it is about, read from the notification's
/// `link` (the web path the server gives every notification), or the inbox. Cases shared with
/// Android: apps/mobile-fixtures/notification-link-cases.json (`cases` for the screen, `items` for
/// what iOS also opens inside it).
enum AppTarget: Equatable, Hashable, Sendable {
    /// One approval task: its decision opens (`/inbox?task=<id>`).
    case approvalTask(String)
    /// An approval request: the task for it, if it waits for this person (`/inbox?request=<id>`).
    case approvalRequest(String)
    /// The approvals inbox (`/inbox`).
    case approvals
    /// The notifications inbox: links the app has no screen for land here, with the item.
    case notifications
    /// One leave request (`/leave?request=<id>`).
    case leaveRequest(String)
    case leave
    /// The team calendar (`/leave/team`).
    case leaveCalendar
    /// One claim (`/claims/<id>`).
    case claim(String)
    case claims
    /// One payslip (`/me/payslips/<id>`).
    case payslip(String)
    case payslips
    /// My schedule (`/schedules/me`).
    case schedule
    /// My profile (`/me/profile`).
    case profile
    /// The clock on Today (`/attendance`).
    case clock

    /// The tab that shows it (`MainTab`).
    var tab: MainTab {
        switch self {
        case .approvalTask, .approvalRequest, .approvals, .notifications: .inbox
        case .leaveRequest, .leave, .leaveCalendar: .leave
        case .claim, .claims: .claims
        case .payslip, .payslips: .pay
        case .schedule: .schedule
        case .profile: .profile
        case .clock: .today
        }
    }

    /// The screen, as both apps name it (`opens` in the fixture's `cases`); nil for the
    /// notifications inbox, where links the app has no screen for stay.
    var opens: String? {
        switch self {
        case .approvalTask, .approvalRequest, .approvals: "approvals"
        case .notifications: nil
        case .leaveRequest, .leave: "leave"
        case .leaveCalendar: "leave-calendar"
        case .claim: "claim"
        case .claims: "claims"
        case .payslip: "payslip"
        case .payslips: "payslips"
        case .schedule: "schedule"
        case .profile: "profile"
        case .clock: "clock"
        }
    }

    /// The item both apps open on that screen (`id` in the fixture's `cases`): a claim or a payslip.
    var opensID: String? {
        switch self {
        case .claim(let i), .payslip(let i): i
        default: nil
        }
    }

    /// The item iOS opens (`item` in the fixture's `items`).
    var kind: String {
        switch self {
        case .approvalTask: "approvalTask"
        case .approvalRequest: "approvalRequest"
        case .approvals: "approvals"
        case .notifications: "notifications"
        case .leaveRequest: "leaveRequest"
        case .leave: "leave"
        case .leaveCalendar: "leaveCalendar"
        case .claim: "claim"
        case .claims: "claims"
        case .payslip: "payslip"
        case .payslips: "payslips"
        case .schedule: "schedule"
        case .profile: "profile"
        case .clock: "clock"
        }
    }

    var id: String? {
        switch self {
        case .approvalTask(let i), .approvalRequest(let i), .leaveRequest(let i), .claim(let i), .payslip(let i): i
        default: nil
        }
    }

    /// The target of a notification link: a path on the server (`/leave?request=…`), never a full
    /// URL (a link to anywhere else opens the notifications inbox). An id is 1 to 64 letters,
    /// digits and hyphens; the query matters only where a case reads it.
    static func from(link: String?) -> AppTarget {
        guard let link = link?.trimmingCharacters(in: .whitespaces), link.hasPrefix("/"), !link.hasPrefix("//"),
              let c = URLComponents(string: link) else { return .notifications }
        let path = c.path.split(separator: "/").map(String.init)
        let query = Dictionary((c.queryItems ?? []).compactMap { q in q.value.map { (q.name, $0) } }, uniquingKeysWith: { a, _ in a })
        func id(_ s: String?) -> String? {
            guard let s, (1...64).contains(s.count), s.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }) else { return nil }
            return s
        }
        switch path {
        case ["inbox"]:
            if let t = id(query["task"]) { return .approvalTask(t) }
            if let r = id(query["request"]) { return .approvalRequest(r) }
            return .approvals
        case ["leave"]:
            return id(query["request"]).map(AppTarget.leaveRequest) ?? .leave
        case ["leave", "team"]:
            return .leaveCalendar
        case ["claims"]:
            return .claims
        case ["me", "payslips"]:
            return .payslips
        case ["schedules", "me"]:
            return .schedule
        case ["me", "profile"]:
            return .profile
        case ["attendance"]:
            return .clock
        default:
            // `/claims/admin` is the web's admin view, not a claim.
            if path.count == 2, path[0] == "claims", path[1] != "admin", let i = id(path[1]) { return .claim(i) }
            if path.count == 3, path[0] == "me", path[1] == "payslips", let i = id(path[2]) { return .payslip(i) }
            return .notifications
        }
    }
}
