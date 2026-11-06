package crowtech.crowhr.api

import kotlinx.serialization.Serializable

/*
 * Thin, hand-written models for the /api/v1 routes the app uses (add-mobile-apps design
 * decision 1: hand-written thin client instead of a generator). Only the fields the screens
 * need; unknown fields are ignored and server enums are strings, so newer servers decode.
 * Shapes follow packages/core/openapi/v1.snapshot.json.
 */

@Serializable data class UnreadCount(val unread: Int)
@Serializable data class Items<T>(val items: List<T>)

// --- GET /api/v1/me ---
@Serializable data class MeUser(val id: String, val email: String, val displayName: String, val preferredName: String? = null, val fullName: String = "")
@Serializable data class MeOrg(val id: String, val name: String, val slug: String? = null)
@Serializable data class Me(
    val user: MeUser,
    val organisation: MeOrg,
    val membershipId: String,
    val employeeId: String? = null,
    val roles: List<String> = emptyList(),
    val demoMode: Boolean = false,
)

// --- Profile (GET /api/v1/people/me/profile), read-only ---
@Serializable data class Named(val id: String = "", val name: String)
@Serializable data class ProfileJob(val jobTitle: String = "", val department: Named? = null, val location: Named? = null, val manager: Named? = null)
@Serializable data class ProfileStatus(val code: String = "", val label: String = "")
@Serializable data class ProfileEmployee(
    val employeeNumber: String = "",
    val name: String,
    val legalName: String = "",
    val preferredName: String? = null,
    val workEmail: String? = null,
    val status: ProfileStatus? = null,
    val job: ProfileJob? = null,
)
@Serializable data class ProfilePersonal(val idType: String = "", val idNumberMasked: String = "", val dob: String? = null, val mobile: String? = null, val personalEmail: String? = null)
@Serializable data class Profile(val employee: ProfileEmployee, val personal: ProfilePersonal? = null)

// --- Payslips ---
@Serializable data class PayslipSummary(
    val id: String,
    val title: String,
    val month: String,
    val payDate: String,
    val netCents: Long,
    val netPayableCents: Long,
    val runKind: String = "regular",
    val releasedAt: String = "",
    val revised: Boolean = false,
)
@Serializable data class PayLine(val label: String, val amountCents: Long, val detail: String? = null)
@Serializable data class PayBasic(val amountCents: Long, val detail: String? = null)
@Serializable data class PayOvertime(val hours: Double, val payCents: Long)
@Serializable data class PayEmployee(val name: String, val employeeNumber: String = "", val idMasked: String = "", val jobTitle: String? = null, val department: String? = null)
@Serializable data class PayEmployer(val legalName: String)
@Serializable data class PayCpf(val rateTableLabel: String? = null, val ageBand: String? = null, val residency: String = "")
@Serializable data class Payslip(
    val id: String,
    val title: String,
    val employer: PayEmployer,
    val employee: PayEmployee,
    val payDate: String,
    val periodStart: String,
    val periodEnd: String,
    val basic: PayBasic? = null,
    val allowances: List<PayLine> = emptyList(),
    val additional: List<PayLine> = emptyList(),
    val overtime: PayOvertime? = null,
    val deductions: List<PayLine> = emptyList(),
    val reimbursements: List<PayLine> = emptyList(),
    val grossCents: Long,
    val totalDeductionsCents: Long,
    val netCents: Long,
    val netPayableCents: Long,
    val employerCpfCents: Long = 0,
    val cpf: PayCpf? = null,
)

// --- Leave ---
@Serializable data class LeaveBalance(
    val typeId: String,
    val code: String,
    val name: String,
    val unit: String = "days",
    val tracked: Boolean = true,
    val eligible: Boolean = true,
    val eligibleFrom: String? = null,
    val year: Int = 0,
    val entitlement: Double = 0.0,
    val carriedForward: Double = 0.0,
    val taken: Double = 0.0,
    val pending: Double = 0.0,
    val available: Double? = null,
    val explanation: List<String> = emptyList(),
)
@Serializable data class LeaveType(
    val id: String,
    val code: String,
    val name: String,
    val halfDays: Boolean = false,
    val attachment: String = "none",
    val attachmentLabel: String? = null,
    val needsChild: Boolean = false,
    val archived: Boolean = false,
)
@Serializable data class LeaveRef(val id: String, val name: String, val code: String = "")
@Serializable data class LeaveRequest(
    val id: String,
    val employee: LeaveRef,
    val type: LeaveRef,
    val startDate: String,
    val endDate: String,
    val startSession: String = "full",
    val endSession: String = "full",
    val unit: String = "days",
    val quantity: Double = 0.0,
    val reason: String? = null,
    val status: String,
    val createdAt: String = "",
)
@Serializable data class LeaveAttachment(val filename: String, val contentType: String, val dataBase64: String)
@Serializable data class LeaveApplication(
    val leaveTypeId: String,
    val startDate: String,
    val endDate: String,
    val startSession: String = "full",
    val endSession: String = "full",
    val reason: String? = null,
    val attachments: List<LeaveAttachment>? = null,
)
@Serializable data class LeaveQuoteRequest(val leaveTypeId: String, val startDate: String, val endDate: String, val startSession: String = "full", val endSession: String = "full")
@Serializable data class QuoteIssue(val code: String = "", val path: String = "", val message: String)
@Serializable data class QuoteYear(val year: Int, val quantity: Double, val tracked: Boolean = true, val available: Double? = null, val after: Double? = null)
@Serializable data class LeaveQuote(
    val unit: String = "days",
    val quantity: Double,
    val years: List<QuoteYear> = emptyList(),
    val issues: List<QuoteIssue> = emptyList(),
    val warnings: List<String> = emptyList(),
    val ok: Boolean,
)
@Serializable data class CancelLeave(val reason: String? = null)

// --- Claims ---
@Serializable data class ClaimSummary(
    val id: String,
    val claimNumber: String? = null,
    val status: String,
    val title: String? = null,
    val totalCents: Long,
    val lineCount: Int = 0,
    val typeNames: List<String> = emptyList(),
    val expenseFrom: String? = null,
    val submittedAt: String? = null,
)
@Serializable data class ClaimPage(val items: List<ClaimSummary>, val total: Int = 0)
@Serializable data class ClaimTypeOption(
    val id: String,
    val code: String,
    val name: String,
    val category: String = "other",
    val receiptRule: String = "never",
    val receiptAboveCents: Long? = null,
    val receiptHint: String = "",
)
@Serializable data class Receipt(val id: String, val name: String, val mime: String = "", val sizeBytes: Long = 0)
@Serializable data class ClaimLineInput(
    val claimTypeId: String,
    val expenseDate: String,
    val merchant: String,
    val description: String,
    val currency: String = "SGD",
    val amountMinor: Long,
    val rate: String? = null,
    val receiptIds: List<String> = emptyList(),
)
@Serializable data class ClaimInput(val title: String? = null, val lines: List<ClaimLineInput>, val submit: Boolean)
@Serializable data class ClaimCreated(val id: String, val claimNumber: String? = null, val status: String, val totalCents: Long)

// --- Scheduling ---
@Serializable data class Shift(
    val id: String,
    val scopeLabel: String = "",
    val date: String,
    val kind: String = "shift",
    val start: String? = null,
    val end: String? = null,
    val breakMinutes: Int = 0,
    val paidMinutes: Int = 0,
    val templateCode: String? = null,
    val note: String? = null,
    val pendingSwap: Boolean = false,
)
@Serializable data class RosterWeek(val weekStart: String, val published: Boolean)
@Serializable data class MySchedule(
    val employeeId: String? = null,
    val from: String,
    val to: String,
    val shifts: List<Shift> = emptyList(),
    val weeks: List<RosterWeek> = emptyList(),
    val openShifts: List<Shift> = emptyList(),
)

// --- Approvals ---
@Serializable data class TaskStep(val position: Int, val of: Int, val label: String)
@Serializable data class Requester(val name: String)
@Serializable data class ApprovalTask(
    val taskId: String,
    val requestId: String,
    val subjectType: String,
    val subjectLabel: String = "",
    val title: String,
    val requester: Requester,
    val submittedAt: String,
    val dueOn: String? = null,
    val overdueDays: Int = 0,
    val origin: String = "resolved",
    val onBehalfOf: String? = null,
    val inline: Boolean = true,
    val step: TaskStep? = null,
)
@Serializable data class SummaryLine(val label: String, val value: String)
@Serializable data class RequestSummary(val title: String = "", val lines: List<SummaryLine> = emptyList(), val context: List<SummaryLine> = emptyList())
@Serializable data class ApprovalRequestDetail(
    val id: String,
    val title: String,
    val status: String,
    val requester: Requester,
    val summary: RequestSummary? = null,
)
@Serializable data class Decision(val decision: String, val comment: String? = null)
@Serializable data class DecisionResult(val taskId: String, val outcome: String, val requestStatus: String = "", val replayed: Boolean = false)

// --- Notifications ---
@Serializable data class AppNotification(
    val id: String,
    val kind: String = "",
    val category: String = "",
    val title: String,
    val body: String? = null,
    val link: String = "",
    val createdAt: String,
    val readAt: String? = null,
)
/**
 * [cursor] (servers from Nov 2026): opaque position, passed back as `since`. Older servers don't
 * send the field at all, which decodes to [NO_CURSOR_FIELD] so the app can fall back.
 */
@Serializable data class NotificationPage(
    val items: List<AppNotification>,
    val total: Int = 0,
    val unread: Int = 0,
    val cursor: String? = NO_CURSOR_FIELD,
) {
    val supportsCursor: Boolean get() = cursor != NO_CURSOR_FIELD

    companion object {
        const val NO_CURSOR_FIELD = "\u0000no-cursor-field"
    }
}

// --- Attendance ---
@Serializable data class PunchView(
    val id: String = "",
    val kind: String = "in",
    val deviceTime: String = "",
    val recordedAt: String = "",
    val status: String = "",
    val flags: List<String> = emptyList(),
    val voided: Boolean = false,
)
@Serializable data class OfficeInfo(val name: String, val radiusMetres: Double = 0.0)
@Serializable data class LocationPolicy(val mode: String = "off", val pdpaNotice: String? = null, val offices: List<OfficeInfo> = emptyList())
@Serializable data class AttendanceMe(
    val employeeId: String? = null,
    val serverTime: String = "",
    val clockedIn: Boolean = false,
    val lastPunch: PunchView? = null,
    val today: List<PunchView> = emptyList(),
    val location: LocationPolicy = LocationPolicy(),
    val networkRestricted: Boolean = false,
)
