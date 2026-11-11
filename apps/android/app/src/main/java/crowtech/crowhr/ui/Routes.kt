package crowtech.crowhr.ui

/** Screens pushed on top of a tab. */
sealed interface Route {
    data class PayslipDetail(val id: String) : Route
    data object LeaveApply : Route
    data object Claims : Route
    data object NewClaim : Route
    data object Schedule : Route
    data object Notifications : Route
    data object Profile : Route
    data object Settings : Route
    data object Licences : Route

    /**
     * A stable string for the saved back stack (rotation, process death) and for the key of the
     * screen's own saved state.
     */
    val code: String
        get() = when (this) {
            is PayslipDetail -> "payslip:$id"
            LeaveApply -> "leave-apply"
            Claims -> "claims"
            NewClaim -> "new-claim"
            Schedule -> "schedule"
            Notifications -> "notifications"
            Profile -> "profile"
            Settings -> "settings"
            Licences -> "licences"
        }

    companion object {
        private val simple: List<Route> by lazy { listOf(LeaveApply, Claims, NewClaim, Schedule, Notifications, Profile, Settings, Licences) }

        /** The route for [code], or null for a code this version doesn't know. */
        fun decode(code: String): Route? =
            if (code.startsWith("payslip:")) code.removePrefix("payslip:").takeIf { it.isNotBlank() }?.let(::PayslipDetail)
            else simple.firstOrNull { it.code == code }

        /** A saved stack back as routes; unknown codes are dropped. */
        fun decodeStack(codes: List<String>): List<Route> = codes.mapNotNull(::decode)
    }
}
