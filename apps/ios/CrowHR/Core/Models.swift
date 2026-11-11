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

    /// Managers and admins see the approvals inbox; the server still decides per task.
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

struct LeaveApplication: Encodable, Sendable {
    struct Attachment: Encodable, Sendable { let filename: String; let contentType: String; let dataBase64: String }
    let leaveTypeId: String
    let startDate: String
    let endDate: String
    let startSession: String
    let endSession: String
    var reason: String? = nil
    var attachments: [Attachment]? = nil
}

struct LeaveQuote: Decodable, Sendable, Equatable {
    struct Year: Decodable, Sendable, Equatable { let year: Int; let quantity: Double; let tracked: Bool; let available: Double?; let after: Double? }
    struct Issue: Decodable, Sendable, Equatable { let code: String; let message: String }
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

    var statusLabel: (String, Tone) {
        switch status {
        case "draft": ("Draft", .neutral)
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

struct NewClaim: Encodable, Sendable {
    struct Line: Encodable, Sendable {
        let claimTypeId: String
        let expenseDate: String
        let merchant: String
        let description: String
        let currency: String
        let amountMinor: Int
        let receiptIds: [String]
    }
    let title: String?
    let lines: [Line]
    let submit: Bool
}

struct CreatedClaim: Decodable, Sendable { let id: String; let status: String; let claimNumber: String? }

struct ScheduleMe: Decodable, Sendable, Equatable {
    struct Shift: Decodable, Sendable, Identifiable, Equatable {
        let id: String
        let scopeLabel: String
        let date: String
        let kind: String
        let start: String?
        let end: String?
        let breakMinutes: Double
        let note: String?
    }
    let from: String
    let to: String
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

struct NotificationPage: Decodable, Sendable { let items: [InboxNotification]; let total: Int; let unread: Int; let cursor: String? }

struct InboxNotification: Decodable, Sendable, Identifiable, Equatable {
    let id: String
    let kind: String
    let category: String
    let title: String
    let body: String?
    let createdAt: String
    let readAt: String?
}

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
