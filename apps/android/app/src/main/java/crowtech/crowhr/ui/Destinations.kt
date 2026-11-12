package crowtech.crowhr.ui

import crowtech.crowhr.connect.AppScreen
import crowtech.crowhr.notify.NotificationLinks

/** A place in the app: a tab and the screens pushed on it. */
data class Destination(val tab: Tab, val routes: List<Route> = emptyList())

/** A request to open something from outside the screen: a tapped local notification. */
data class OpenRequest(
    /** "approvals" or "notifications": the inbox to fall back to. */
    val inbox: String,
    /** The one new item's `link`, when the notification was for a single item. */
    val link: String? = null,
    /** The connection the news is for, when it's for one connection. */
    val connectionKey: String? = null,
    /** The one new item, to mark read once it is open. */
    val notificationId: String? = null,
)

object Destinations {
    /**
     * Where a notification link opens (notification-link-cases.json), or null when the app has no
     * screen for it or the server doesn't offer that screen ([available]).
     */
    fun forLink(link: String?, available: (AppScreen) -> Boolean): Destination? {
        val d = NotificationLinks.parse(link) ?: return null
        val (screen, destination) = when (d.opens) {
            NotificationLinks.Opens.Approvals -> AppScreen.Approvals to Destination(Tab.Tasks)
            NotificationLinks.Opens.Leave -> AppScreen.Leave to Destination(Tab.Leave)
            NotificationLinks.Opens.LeaveCalendar -> AppScreen.Leave to Destination(Tab.Leave, listOf(Route.LeaveCalendar))
            NotificationLinks.Opens.Claims -> AppScreen.Claims to Destination(Tab.More, listOf(Route.Claims))
            NotificationLinks.Opens.Claim -> AppScreen.Claims to Destination(Tab.More, listOf(Route.Claims, Route.ClaimDetail(d.id!!)))
            NotificationLinks.Opens.Payslips -> AppScreen.Payslips to Destination(Tab.Pay)
            NotificationLinks.Opens.Payslip -> AppScreen.Payslips to Destination(Tab.Pay, listOf(Route.PayslipDetail(d.id!!)))
            NotificationLinks.Opens.Schedule -> AppScreen.Schedule to Destination(Tab.More, listOf(Route.Schedule))
            NotificationLinks.Opens.Profile -> null to Destination(Tab.More, listOf(Route.Profile))
            NotificationLinks.Opens.Clock -> AppScreen.Clock to Destination(Tab.Clock)
        }
        return destination.takeIf { screen == null || available(screen) }
    }

    /** The inbox a notification for several items (or for one the app can't show) opens. */
    fun inbox(inbox: String, available: (AppScreen) -> Boolean): Destination =
        if (inbox == "approvals" && available(AppScreen.Approvals)) Destination(Tab.Tasks)
        else if (available(AppScreen.Notifications)) Destination(Tab.More, listOf(Route.Notifications))
        else Destination(Tab.More)

    fun forRequest(request: OpenRequest, available: (AppScreen) -> Boolean): Destination =
        forLink(request.link, available) ?: inbox(request.inbox, available)

    /** "3 to approve" / "12 unread": what TalkBack adds to a tab with a badge. */
    fun badgeSpoken(tab: Tab, count: Int): String = when (tab) {
        Tab.Tasks -> "$count to approve"
        else -> "$count unread ${if (count == 1) "notification" else "notifications"}"
    }

    /** The badge's text: up to 99, then "99+". */
    fun badgeText(count: Int): String = if (count > 99) "99+" else count.toString()
}
