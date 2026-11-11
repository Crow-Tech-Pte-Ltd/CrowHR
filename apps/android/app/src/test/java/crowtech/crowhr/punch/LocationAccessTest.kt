package crowtech.crowhr.punch

import android.Manifest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Clock-in location: precise or approximate are both used; both are asked for together. */
class LocationAccessTest {
    @Test fun preciseAndApproximateAreAskedForTogether() {
        // Apps targeting Android 12+ that ask for precise alone get no approximate option.
        assertEquals(setOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), LocationAccess.PERMISSIONS.toSet())
    }

    @Test fun approximateLocationIsEnough() {
        assertTrue(LocationAccess.grantedIn(mapOf(Manifest.permission.ACCESS_FINE_LOCATION to false, Manifest.permission.ACCESS_COARSE_LOCATION to true)))
        assertTrue(LocationAccess.grantedIn(mapOf(Manifest.permission.ACCESS_FINE_LOCATION to true, Manifest.permission.ACCESS_COARSE_LOCATION to true)))
        assertFalse(LocationAccess.grantedIn(mapOf(Manifest.permission.ACCESS_FINE_LOCATION to false, Manifest.permission.ACCESS_COARSE_LOCATION to false)))
        assertFalse(LocationAccess.grantedIn(emptyMap()))
        assertTrue(LocationAccess.granted(fine = false, coarse = true))
    }

    @Test fun providersBestFirstAndOnlyEnabledOnes() {
        val all = { _: String -> true }
        assertEquals(listOf("fused", "gps", "network"), LocationAccess.providers(37, fine = true, enabled = all))
        // Android 12+ coarsens GPS results for approximate-only apps.
        assertEquals(listOf("fused", "gps", "network"), LocationAccess.providers(31, fine = false, enabled = all))
        // Before Android 12 the GPS provider needs precise location.
        assertEquals(listOf("network"), LocationAccess.providers(30, fine = false, enabled = all))
        assertEquals(listOf("gps", "network"), LocationAccess.providers(29, fine = true, enabled = all))
        assertEquals(listOf("network"), LocationAccess.providers(37, fine = true) { it == "network" })
        assertEquals(emptyList<String>(), LocationAccess.providers(37, fine = true) { false })
    }

    @Test fun aMissingLocationIsExplained() {
        assertTrue(LocationAccess.missingMessage(required = true, allowed = false).contains("Android Settings"))
        assertTrue(LocationAccess.missingMessage(required = true, allowed = true).contains("couldn't find it"))
        assertFalse(LocationAccess.missingMessage(required = false, allowed = false).contains("review"))
    }
}
