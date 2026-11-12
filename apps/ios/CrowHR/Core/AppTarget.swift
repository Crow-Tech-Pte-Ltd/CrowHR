import Foundation

/// Where the app goes for a notification: the item it is about, read from the notification's
/// `link` (the web path the server gives every notification), or the inbox. Cases shared with
/// Android: apps/mobile-fixtures/notification-link-cases.json.
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

    /// The tab that shows it (`MainTab`).
    var tab: MainTab {
        switch self {
        case .approvalTask, .approvalRequest, .approvals, .notifications: .inbox
        case .leaveRequest, .leave, .leaveCalendar: .leave
        case .claim, .claims: .claims
        case .payslip, .payslips: .pay
        case .schedule: .schedule
        case .profile: .profile
        }
    }

    /// The fixture name of the case (`kind` in notification-link-cases.json).
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
        }
    }

    var id: String? {
        switch self {
        case .approvalTask(let i), .approvalRequest(let i), .leaveRequest(let i), .claim(let i), .payslip(let i): i
        default: nil
        }
    }

    /// The target of a notification link: a path on the server (`/leave?request=…`), never a full
    /// URL (a link to anywhere else opens the notifications inbox). IDs must look like UUIDs.
    static func from(link: String?) -> AppTarget {
        guard let link, link.hasPrefix("/"), !link.hasPrefix("//"),
              let c = URLComponents(string: link) else { return .notifications }
        let path = c.path.split(separator: "/").map(String.init)
        let query = Dictionary((c.queryItems ?? []).compactMap { q in q.value.map { (q.name, $0) } }, uniquingKeysWith: { a, _ in a })
        func uuid(_ s: String?) -> String? {
            guard let s, UUID(uuidString: s) != nil else { return nil }
            return s.lowercased()
        }
        switch path.first ?? "" {
        case "inbox" where path.count == 1:
            if let t = uuid(query["task"]) { return .approvalTask(t) }
            if let r = uuid(query["request"]) { return .approvalRequest(r) }
            return .approvals
        case "leave":
            if path.count == 1 { return uuid(query["request"]).map(AppTarget.leaveRequest) ?? .leave }
            if path.count == 2, path[1] == "team" { return .leaveCalendar }
        case "claims":
            if path.count == 1 { return .claims }
            if path.count == 2, let id = uuid(path[1]) { return .claim(id) }
        case "me":
            if path.count >= 2, path[1] == "payslips" {
                if path.count == 2 { return .payslips }
                if path.count == 3, let id = uuid(path[2]) { return .payslip(id) }
            }
            if path.count == 2, path[1] == "profile" { return .profile }
        case "payslips" where path.count == 1:
            return .payslips
        case "schedules" where path.count == 2 && path[1] == "me":
            return .schedule
        default:
            break
        }
        return .notifications
    }
}
