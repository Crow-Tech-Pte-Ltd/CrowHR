package crowtech.crowhr.notify

/**
 * Where a notification's `link` (a path in Crow HR on the web) opens in the app
 * (apps/mobile-fixtures/notification-link-cases.json). Null: the app has no screen for it.
 */
object NotificationLinks {
    enum class Opens(val code: String) {
        Approvals("approvals"), Leave("leave"), LeaveCalendar("leave-calendar"), Claims("claims"), Claim("claim"),
        Payslips("payslips"), Payslip("payslip"), Schedule("schedule"), Profile("profile"), Clock("clock"),
    }

    data class Destination(val opens: Opens, val id: String? = null)

    private val ID = Regex("^[A-Za-z0-9-]{1,64}$")

    fun parse(link: String?): Destination? {
        val value = link?.trim().orEmpty()
        if (!value.startsWith("/") || value.startsWith("//")) return null
        val path = value.substringBefore('#').substringBefore('?').trimEnd('/').ifEmpty { "/" }
        val segments = path.removePrefix("/").split('/').filter { it.isNotEmpty() }
        return when {
            segments == listOf("inbox") -> Destination(Opens.Approvals)
            segments == listOf("leave") -> Destination(Opens.Leave)
            segments == listOf("leave", "team") -> Destination(Opens.LeaveCalendar)
            segments == listOf("claims") -> Destination(Opens.Claims)
            segments.size == 2 && segments[0] == "claims" && ID.matches(segments[1]) && segments[1] !in RESERVED -> Destination(Opens.Claim, segments[1])
            segments == listOf("me", "payslips") -> Destination(Opens.Payslips)
            segments.size == 3 && segments[0] == "me" && segments[1] == "payslips" && ID.matches(segments[2]) -> Destination(Opens.Payslip, segments[2])
            segments == listOf("schedules", "me") -> Destination(Opens.Schedule)
            segments == listOf("me", "profile") -> Destination(Opens.Profile)
            segments == listOf("attendance") -> Destination(Opens.Clock)
            else -> null
        }
    }

    /** Web pages under /claims that are not a claim (the admin view). */
    private val RESERVED = setOf("admin")
}
