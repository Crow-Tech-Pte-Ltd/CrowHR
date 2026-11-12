package crowtech.crowhr.ui

/** Screens pushed on top of a tab. */
sealed interface Route {
    data class PayslipDetail(val id: String) : Route
    data object LeaveApply : Route
    data object LeaveCalendar : Route
    data object Claims : Route
    data object NewClaim : Route
    data class ClaimDetail(val id: String) : Route
    /** A draft opened for changes (also a copy of a rejected or withdrawn claim). */
    data class EditClaim(val id: String) : Route
    data object Schedule : Route
    /** Offer one of my shifts to a colleague: swap it or give it away. */
    data class OfferShift(val rosterId: String, val shiftId: String) : Route
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
            LeaveCalendar -> "leave-calendar"
            Claims -> "claims"
            NewClaim -> "new-claim"
            is ClaimDetail -> "claim:$id"
            is EditClaim -> "claim-edit:$id"
            Schedule -> "schedule"
            is OfferShift -> "swap-offer:$rosterId:$shiftId"
            Notifications -> "notifications"
            Profile -> "profile"
            Settings -> "settings"
            Licences -> "licences"
        }

    companion object {
        private val simple: List<Route> by lazy {
            listOf(LeaveApply, LeaveCalendar, Claims, NewClaim, Schedule, Notifications, Profile, Settings, Licences)
        }

        private fun id(code: String, prefix: String): String? =
            code.removePrefix(prefix).takeIf { code.startsWith(prefix) && it.isNotBlank() && ':' !in it }

        /** The route for [code], or null for a code this version doesn't know. */
        fun decode(code: String): Route? {
            id(code, "payslip:")?.let { return PayslipDetail(it) }
            id(code, "claim:")?.let { return ClaimDetail(it) }
            id(code, "claim-edit:")?.let { return EditClaim(it) }
            if (code.startsWith("swap-offer:")) {
                val parts = code.removePrefix("swap-offer:").split(':')
                return if (parts.size == 2 && parts.all { it.isNotBlank() }) OfferShift(parts[0], parts[1]) else null
            }
            return simple.firstOrNull { it.code == code }
        }

        /** A saved stack back as routes; unknown codes are dropped. */
        fun decodeStack(codes: List<String>): List<Route> = codes.mapNotNull(::decode)
    }
}
