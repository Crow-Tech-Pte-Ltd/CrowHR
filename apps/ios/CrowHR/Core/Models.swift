import Foundation

// Thin hand-written models for the `/api/v1` routes the app uses (add-mobile-apps decision 1:
// hand-written clients instead of a generator). Enums are plain strings so unknown values from
// newer servers decode fine; unknown fields are ignored.

struct Me: Decodable, Sendable, Equatable {
    struct User: Decodable, Sendable, Equatable { let id: String; let email: String; let displayName: String; let fullName: String? }
    struct Org: Decodable, Sendable, Equatable { let id: String; let name: String; let slug: String? }
    let user: User
    let organisation: Org
    let membershipId: String
    let employeeId: String?
    let roles: [String]
    let permissions: [String: [String]]?

    /// Managers and admins see the approvals inbox up front; anyone else once tasks wait for them
    /// (`ApprovalsAccess`). The server still decides per task.
    var mayApprove: Bool { roles.contains { ["owner", "hr_admin", "payroll_admin", "manager"].contains($0) } }
}

struct PayslipList: Decodable, Sendable { let items: [PayslipSummary] }

struct PayslipSummary: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let title: String
    let month: String
    let payDate: String
    let netPayableCents: Int
    let runKind: String
    let revised: Bool
}

struct PayLine: Decodable, Sendable, Equatable, Hashable {
    let label: String
    let amountCents: Int
    let detail: String?
}

struct PayslipDetail: Decodable, Sendable, Equatable {
    struct Employer: Decodable, Sendable, Equatable { let legalName: String }
    struct Employee: Decodable, Sendable, Equatable { let name: String; let employeeNumber: String; let idMasked: String; let jobTitle: String?; let department: String? }
    struct Basic: Decodable, Sendable, Equatable { let amountCents: Int; let detail: String? }
    struct Overtime: Decodable, Sendable, Equatable { let hours: Double; let payCents: Int }
    let id: String
    let title: String
    let employer: Employer
    let employee: Employee
    let payDate: String
    let periodStart: String
    let periodEnd: String
    let basic: Basic?
    let allowances: [PayLine]
    let additional: [PayLine]
    let overtime: Overtime?
    let deductions: [PayLine]
    let reimbursements: [PayLine]
    let grossCents: Int
    let totalDeductionsCents: Int
    let netCents: Int
    let netPayableCents: Int
    let employerCpfCents: Int
}

struct LeaveBalanceList: Decodable, Sendable { let items: [LeaveBalance] }

struct LeaveBalance: Decodable, Sendable, Identifiable, Equatable {
    var id: String { typeId + (childId ?? "") }
    let typeId: String
    let code: String
    let name: String
    let unit: String
    let tracked: Bool
    let eligible: Bool
    let childId: String?
    let entitlement: Double
    let taken: Double
    let pending: Double
    let available: Double?
    var statutoryCode: String? = nil
}

struct LeaveTypeList: Decodable, Sendable { let items: [LeaveType] }

struct LeaveType: Decodable, Sendable, Identifiable, Equatable, Hashable {
    let id: String
    let code: String
    let name: String
    let halfDays: Bool
    let attachment: String
    let attachmentLabel: String?
    let needsChild: Bool
    let archived: Bool
}

struct LeaveChildList: Decodable, Sendable { let items: [LeaveChild] }

/// A child on the employee's record (`GET /api/v1/leave/children`), for the leave types that
/// must name one (maternity, paternity, shared parental, adoption, unpaid infant care).
struct LeaveChild: Decodable, Sendable, Identifiable, Equatable, Hashable {
    let id: String
    let name: String
}

struct LeaveApplication: Encodable, Sendable, Equatable {
    struct Attachment: Encodable, Sendable, Equatable { let filename: String; let contentType: String; let dataBase64: String }
    let leaveTypeId: String
    let startDate: String
    let endDate: String
    let startSession: String
    let endSession: String
    /// Only for a type that needs a child; left out otherwise.
    var childId: String? = nil
    var reason: String? = nil
    var attachments: [Attachment]? = nil
}

struct LeaveQuote: Decodable, Sendable, Equatable {
    struct Year: Decodable, Sendable, Equatable { let year: Int; let quantity: Double; let tracked: Bool; let available: Double?; let after: Double? }
    /// `path` names the field (`childId`, `startDate`, ...), so the form can show it there.
    struct Issue: Decodable, Sendable, Equatable { let code: String; var path: String? = nil; let message: String }
    let unit: String
    let quantity: Double
    let years: [Year]
    let issues: [Issue]
    let warnings: [String]
    let ok: Bool
}

struct LeaveRequestList: Decodable, Sendable { let items: [LeaveRequest] }

struct LeaveRequest: Decodable, Sendable, Identifiable, Equatable {
    struct TypeRef: Decodable, Sendable, Equatable { let id: String; let name: String }
    let id: String
    let type: TypeRef
    let startDate: String
    let endDate: String
    let startSession: String
    let endSession: String
    let unit: String
    let quantity: Double
    let reason: String?
    let status: String

    var statusLabel: (String, Tone) {
        switch status {
        case "pending": ("Pending", .warning)
        case "approved": ("Approved", .success)
        case "rejected": ("Rejected", .danger)
        case "withdrawn": ("Withdrawn", .neutral)
        case "cancellation_pending": ("Cancelling", .warning)
        case "cancelled": ("Cancelled", .neutral)
        default: (status.capitalized, .neutral)
        }
    }
}

/// `GET /api/v1/leave/requests/{id}`: one request, opened from the team calendar or a
/// notification.
struct LeaveRequestDetail: Decodable, Sendable, Equatable, Identifiable {
    struct Ref: Decodable, Sendable, Equatable { let id: String; let name: String }
    struct Attachment: Decodable, Sendable, Equatable, Identifiable { let id: String; let filename: String }
    struct Day: Decodable, Sendable, Equatable, Hashable { let date: String; let session: String; let quantity: Double }
    let id: String
    let employee: Ref
    let type: Ref
    let startDate: String
    let endDate: String
    let startSession: String
    let endSession: String
    let unit: String
    let quantity: Double
    let reason: String?
    let status: String
    let child: Ref?
    let attachments: [Attachment]
    let cancelReason: String?
    let days: [Day]?

    /// The same request as a row of "My leave" (status label, dates, quantity).
    var row: LeaveRequest {
        LeaveRequest(id: id, type: .init(id: type.id, name: type.name), startDate: startDate, endDate: endDate,
                     startSession: startSession, endSession: endSession, unit: unit, quantity: quantity, reason: reason, status: status)
    }
}

/// `GET /api/v1/leave/calendar`: who is on leave, by half day, with the public holidays.
struct LeaveCalendar: Decodable, Sendable, Equatable {
    struct Holiday: Decodable, Sendable, Equatable, Hashable { let date: String; let name: String }
    struct Entry: Decodable, Sendable, Equatable, Hashable {
        let date: String
        let session: String
        let status: String
        let label: String
        let requestId: String?
    }
    struct Person: Decodable, Sendable, Equatable, Identifiable {
        var id: String { employeeId }
        let employeeId: String
        let name: String
        let isSelf: Bool
        let entries: [Entry]

        enum CodingKeys: String, CodingKey { case employeeId, name, isSelf = "self", entries }
    }
    let from: String
    let to: String
    let holidays: [Holiday]
    let people: [Person]
}

struct AttendanceMe: Decodable, Sendable, Equatable {
    struct Punch: Decodable, Sendable, Equatable, Identifiable {
        let id: String
        let kind: String
        let recordedAt: String
        let status: String
        let flags: [String]
        let queued: Bool
        let voided: Bool
    }
    struct Location: Decodable, Sendable, Equatable { let mode: String; let pdpaNotice: String? }
    let employeeId: String?
    let clockedIn: Bool
    let today: [Punch]
    let location: Location
}

struct ClaimTypeList: Decodable, Sendable { let items: [ClaimType] }

struct ClaimType: Decodable, Sendable, Identifiable, Equatable, Hashable {
    let id: String
    let name: String
    let category: String
    let receiptRule: String
    let receiptAboveCents: Int?
    let receiptHint: String

    /// The server's rule (claims `receiptRequired`), on the line's amount in SGD.
    func receiptRequired(sgdCents: Int?) -> Bool {
        switch receiptRule {
        case "always": true
        case "above": (sgdCents ?? 0) > (receiptAboveCents ?? 0)
        default: false
        }
    }
}

struct ClaimPage: Decodable, Sendable { let items: [ClaimSummary]; let total: Int }

struct ClaimSummary: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let claimNumber: String?
    let status: String
    let title: String?
    let totalCents: Int
    let typeNames: [String]
    let expenseFrom: String?

    var statusLabel: (String, Tone) { Self.statusLabel(status) }

    static func statusLabel(_ status: String) -> (String, Tone) {
        switch status {
        // Not "Draft": Azeret Mono (the chip's font) draws "ft" as one ligature glyph, which
        // Xcode's accessibility audit reports as clipped text.
        case "draft": ("Not sent", .neutral)
        case "submitted": ("Waiting", .warning)
        case "approved": ("Approved", .success)
        case "rejected": ("Rejected", .danger)
        case "withdrawn": ("Withdrawn", .neutral)
        case "paid": ("Paid", .success)
        default: (status.capitalized, .neutral)
        }
    }
}

struct ReceiptUpload: Decodable, Sendable { let id: String; let name: String }

struct NewClaim: Encodable, Sendable, Equatable {
    struct Line: Encodable, Sendable, Equatable {
        let claimTypeId: String
        let expenseDate: String
        let merchant: String
        let description: String
        let currency: String
        let amountMinor: Int
        /// SGD per 1 unit of a foreign currency, as typed (at most 6 decimals); nil for SGD.
        var rate: String? = nil
        let receiptIds: [String]
    }
    let title: String?
    let lines: [Line]
    let submit: Bool
}

struct CreatedClaim: Decodable, Sendable { let id: String; let status: String; let claimNumber: String? }

/// `GET /api/v1/claims/{id}`: the lines (with currency, rate and SGD amount), status and actions.
struct ClaimDetail: Decodable, Sendable, Equatable, Identifiable {
    struct Line: Decodable, Sendable, Equatable, Identifiable {
        let id: String
        let typeName: String
        let expenseDate: String
        let merchant: String?
        let description: String?
        let currency: String
        let amountMinor: Int
        let rate: String?
        let sgdCents: Int
        let receiptCount: Int
        let receiptRequired: Bool
        let redactedFields: [String]?
        /// Set on a submitted claim when the rate is more than 20% from the organisation's last
        /// rate for the currency: a warning to check it, never a block.
        var fxWarning: FxWarning? = nil
    }
    struct FxWarning: Decodable, Sendable, Equatable {
        let lastRate: String
        let lastRateOn: String
        /// (rate − last rate) / last rate: positive above, negative below.
        let deviationBasisPoints: Int
    }
    struct Actions: Decodable, Sendable, Equatable { let submit: Bool; let delete: Bool; let withdraw: Bool }
    let id: String
    let claimNumber: String?
    let status: String
    let title: String?
    let totalCents: Int
    let payoutMethod: String?
    let reservedByPayrollRun: Bool?
    let paidVia: String?
    let paidOn: String?
    let paidReference: String?
    let submittedAt: String?
    let approvedOn: String?
    let decisionComment: String?
    let lines: [Line]
    let actions: Actions

    /// The title, the type of a one-line claim, or "3 expenses", as on the web.
    var heading: String {
        title ?? (lines.count == 1 ? lines[0].typeName : "\(lines.count) expenses")
    }

    /// The web's "Check the exchange rate." warning, one sentence per line that has one, or nil:
    /// "MYR 0.380000 is 26.15% above the last MYR rate used in your organisation, 0.301234 on
    /// 1 Nov 2026."
    var fxWarningText: String? {
        let each = lines.enumerated().compactMap { i, l -> String? in
            guard let w = l.fxWarning else { return nil }
            let side = w.deviationBasisPoints >= 0 ? "above" : "below"
            return (lines.count > 1 ? "Expense \(i + 1): " : "")
                + "\(l.currency) \(l.rate ?? "") is \(ClaimMoney.formatBasisPoints(w.deviationBasisPoints)) \(side) the last \(l.currency) rate used in your organisation, \(w.lastRate) on \(Fmt.dayString(w.lastRateOn))."
        }
        guard !each.isEmpty else { return nil }
        return (["Check the exchange rate."] + each + ["Compare it with the receipt or card statement."]).joined(separator: "\n")
    }

    /// When it is paid ("With the next payroll", "Paid 30 Nov 2026 by transfer (TT-123)").
    var payout: String {
        switch status {
        case "paid":
            let on = paidOn.map { " \(Fmt.dayString($0))" } ?? ""
            let via = paidVia == "payroll" ? " with payroll" : " by transfer"
            return "Paid\(on)\(via)" + (paidReference.map { " (\($0))" } ?? "")
        case "approved":
            if payoutMethod == "payroll" { return reservedByPayrollRun == true ? "In the current payroll run" : "With the next payroll" }
            return "By transfer, outside payroll"
        default:
            return "After approval"
        }
    }
}

/// `GET /api/v1/scheduling/me`: published shifts (the next 14 days), the open shifts this person
/// may pick up, and their swap and pickup requests. Lists a server doesn't send are empty.
struct ScheduleMe: Decodable, Sendable, Equatable {
    struct Shift: Decodable, Sendable, Identifiable, Equatable {
        let id: String
        var rosterId: String? = nil
        let scopeLabel: String
        let date: String
        let kind: String
        let start: String?
        let end: String?
        let breakMinutes: Double
        var paidMinutes: Double? = nil
        var templateCode: String? = nil
        let note: String?
        var pendingSwap: Bool? = nil
    }
    struct Week: Decodable, Sendable, Equatable { let weekStart: String; let published: Bool }
    let employeeId: String?
    let from: String
    let to: String
    let shifts: [Shift]
    let weeks: [Week]
    let openShifts: [Shift]
    let swaps: [ShiftSwap]

    enum CodingKeys: String, CodingKey { case employeeId, from, to, shifts, weeks, openShifts, swaps }

    init(employeeId: String? = nil, from: String, to: String, shifts: [Shift], weeks: [Week] = [], openShifts: [Shift] = [], swaps: [ShiftSwap] = []) {
        self.employeeId = employeeId
        self.from = from
        self.to = to
        self.shifts = shifts
        self.weeks = weeks
        self.openShifts = openShifts
        self.swaps = swaps
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        employeeId = try c.decodeIfPresent(String.self, forKey: .employeeId)
        from = try c.decode(String.self, forKey: .from)
        to = try c.decode(String.self, forKey: .to)
        shifts = try c.decode([Shift].self, forKey: .shifts)
        weeks = try c.decodeIfPresent([Week].self, forKey: .weeks) ?? []
        openShifts = try c.decodeIfPresent([Shift].self, forKey: .openShifts) ?? []
        swaps = try c.decodeIfPresent([ShiftSwap].self, forKey: .swaps) ?? []
    }
}

/// A swap, give-away or open-shift pickup (`/api/v1/scheduling/swaps`).
struct ShiftSwap: Decodable, Sendable, Identifiable, Equatable {
    struct Person: Decodable, Sendable, Equatable { let id: String; let name: String }
    struct ShiftRef: Decodable, Sendable, Equatable { let id: String; let date: String; let time: String }
    let id: String
    let kind: String
    let status: String
    let direction: String
    let requester: Person
    let peer: Person?
    let shift: ShiftRef
    let peerShift: ShiftRef?
    let note: String?
    let reason: String?
}

/// `POST /api/v1/scheduling/swaps`.
struct NewSwap: Encodable, Sendable, Equatable {
    let kind: String
    let shiftId: String
    var peerEmployeeId: String? = nil
    var peerShiftId: String? = nil
    var note: String? = nil
}

/// `GET /api/v1/scheduling/rosters/{id}`, as far as offering a shift needs it: who is on the
/// published roster, and their shifts.
struct RosterWeek: Decodable, Sendable, Equatable {
    struct Employee: Decodable, Sendable, Equatable, Identifiable { let id: String; let name: String }
    struct Shift: Decodable, Sendable, Equatable, Identifiable {
        let id: String
        let employeeId: String?
        let kind: String
        let date: String
        let start: String?
        let end: String?
        var pendingSwap: Bool? = nil
    }
    let employees: [Employee]
    let shifts: [Shift]
}

struct ApprovalTaskList: Decodable, Sendable { let items: [ApprovalTask] }

struct ApprovalTask: Decodable, Sendable, Identifiable, Equatable {
    struct Requester: Decodable, Sendable, Equatable { let name: String }
    struct Step: Decodable, Sendable, Equatable { let position: Int; let of: Int; let label: String }
    var id: String { taskId }
    let taskId: String
    let requestId: String
    let subjectType: String
    let subjectLabel: String
    let title: String
    let requester: Requester
    let submittedAt: String
    let dueOn: String?
    let overdueDays: Int
    let step: Step
}

/// `GET /api/v1/approvals/requests/{id}`: what the approver decides on (amounts, dates, reason,
/// balance or cap context) and the comments so far, as the web and Android show it.
struct ApprovalRequestDetail: Decodable, Sendable, Equatable {
    struct Line: Decodable, Sendable, Equatable, Hashable { let label: String; let value: String }
    struct Summary: Decodable, Sendable, Equatable { let title: String; let lines: [Line]; let context: [Line] }
    struct Comment: Decodable, Sendable, Equatable, Identifiable { let id: String; let author: String; let body: String; let createdAt: String }
    let summary: Summary?
    let comments: [Comment]

    enum CodingKeys: String, CodingKey { case summary, comments }

    init(summary: Summary?, comments: [Comment]) {
        self.summary = summary
        self.comments = comments
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        summary = try c.decodeIfPresent(Summary.self, forKey: .summary)
        comments = try c.decodeIfPresent([Comment].self, forKey: .comments) ?? []
    }
}

struct Decision: Encodable, Sendable { let decision: String; let comment: String? }
struct DecisionResult: Decodable, Sendable { let outcome: String; let replayed: Bool }

struct NotificationPage: Decodable, Sendable {
    var items: [InboxNotification]
    let total: Int
    var unread: Int
    let cursor: String?
    /// Servers from Nov 2026 always send `cursor` (null in an empty inbox); older ones leave it out.
    let hasCursor: Bool

    enum CodingKeys: String, CodingKey { case items, total, unread, cursor }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = try c.decode([InboxNotification].self, forKey: .items)
        total = try c.decode(Int.self, forKey: .total)
        unread = try c.decode(Int.self, forKey: .unread)
        hasCursor = c.contains(.cursor)
        cursor = try c.decodeIfPresent(String.self, forKey: .cursor)
    }

    /// The page once `id` has been marked read on the server, without fetching it again.
    func markingRead(_ id: String, at instant: String) -> NotificationPage {
        guard let i = items.firstIndex(where: { $0.id == id }), items[i].readAt == nil else { return self }
        var next = self
        next.items[i].readAt = instant
        next.unread = max(0, unread - 1)
        return next
    }
}

struct InboxNotification: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let kind: String
    let category: String
    let title: String
    let body: String?
    /// The web path of what it is about (`/inbox?task=…`, `/leave?request=…`; `AppTarget`).
    var link: String? = nil
    let createdAt: String
    var readAt: String?
}

struct UnreadCount: Decodable, Sendable { let unread: Int }

struct MyProfile: Decodable, Sendable, Equatable {
    struct Employee: Decodable, Sendable, Equatable {
        struct Job: Decodable, Sendable, Equatable {
            struct Ref: Decodable, Sendable, Equatable { let name: String }
            let jobTitle: String
            let department: Ref?
            let location: Ref?
            let manager: Ref?
        }
        struct Personal: Decodable, Sendable, Equatable {
            let idType: String
            let idNumberMasked: String
            let mobile: String?
            let personalEmail: String?
        }
        let employeeNumber: String
        let name: String
        let workEmail: String?
        let job: Job?
        let personal: Personal?
    }
    let employee: Employee
}
