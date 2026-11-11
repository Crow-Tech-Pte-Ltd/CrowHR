package crowtech.crowhr.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The back stack is saved as route codes (rotation, process death) and read back. */
class RoutesTest {
    private val all = listOf(
        Route.PayslipDetail("0b7c4f0e-2f5d-4f4e-9d55-0d6b2b6f3a11"), Route.LeaveApply, Route.Claims, Route.NewClaim,
        Route.Schedule, Route.Notifications, Route.Profile, Route.Settings, Route.Licences,
    )

    @Test fun everyRouteRoundTrips() {
        all.forEach { assertEquals(it, Route.decode(it.code)) }
        assertEquals(all.size, all.map { it.code }.toSet().size)
    }

    @Test fun aSavedStackComesBackInOrder() {
        val stack = listOf(Route.Claims, Route.NewClaim)
        assertEquals(stack, Route.decodeStack(stack.map { it.code }))
    }

    @Test fun unknownCodesFromAnotherVersionAreDropped() {
        assertNull(Route.decode("team-calendar"))
        assertNull(Route.decode("payslip:"))
        assertEquals(listOf(Route.Settings), Route.decodeStack(listOf("team-calendar", "settings")))
    }
}
