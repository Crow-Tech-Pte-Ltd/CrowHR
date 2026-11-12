package crowtech.crowhr.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The back stack is saved as route codes (rotation, process death) and read back. */
class RoutesTest {
    private val all = listOf(
        Route.PayslipDetail("0b7c4f0e-2f5d-4f4e-9d55-0d6b2b6f3a11"), Route.LeaveApply, Route.LeaveCalendar, Route.Claims, Route.NewClaim,
        Route.ClaimDetail("7c3e1a9b-2d4f-4e6a-8b1c-0f5d9e2a6b31"), Route.EditClaim("7c3e1a9b-2d4f-4e6a-8b1c-0f5d9e2a6b31"),
        Route.Schedule, Route.OfferShift("3d9a1c7e-5b2f-4e8a-9c6d-7f1b3e5a2c80", "2b8d4f1a-6c3e-4a9b-b7d2-1e5f8c3a9d40"),
        Route.Notifications, Route.Profile, Route.Settings, Route.Licences,
    )

    @Test fun malformedCodesAreDropped() {
        assertNull(Route.decode("claim:"))
        assertNull(Route.decode("claim-edit:"))
        assertNull(Route.decode("swap-offer:r1"))
        assertNull(Route.decode("swap-offer::s1"))
        assertNull(Route.decode("swap-offer:r1:s1:x"))
    }

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
