package crowtech.crowhr.punch

import android.Manifest

/**
 * When the organisation's attendance policy asks for location (decision logic only, so it is
 * unit tested; the platform calls are in ClockScreen).
 *
 * Android 12+ lets people share only their approximate location, and apps targeting it must ask
 * for precise and approximate together. Either one is enough to send a location: the server
 * compares the distance to the office with the reported accuracy.
 */
object LocationAccess {
    val PERMISSIONS = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)

    fun granted(fine: Boolean, coarse: Boolean): Boolean = fine || coarse

    /** The result of asking for [PERMISSIONS]: allowed when the person chose precise or approximate. */
    fun grantedIn(results: Map<String, Boolean>): Boolean =
        granted(results[Manifest.permission.ACCESS_FINE_LOCATION] == true, results[Manifest.permission.ACCESS_COARSE_LOCATION] == true)

    /**
     * Location providers to ask, best first, among the [enabled] ones. Android 12+ has the
     * platform's own fused provider (not Play Services). Before Android 12 the GPS provider needs
     * precise location, so an approximate-only grant uses the network provider.
     */
    fun providers(sdk: Int, fine: Boolean, enabled: (String) -> Boolean): List<String> {
        val order = buildList {
            if (sdk >= 31) add(FUSED)
            if (fine || sdk >= 31) add(GPS)
            add(NETWORK)
        }
        return order.filter(enabled)
    }

    // LocationManager's provider names (constants here so the logic runs in JVM tests).
    const val FUSED = "fused"
    const val GPS = "gps"
    const val NETWORK = "network"

    /** Shown after a clock-in that went without a location although the policy asks for one. */
    fun missingMessage(required: Boolean, allowed: Boolean): String = when {
        !allowed && required -> "Sent without your location because Crow HR isn't allowed to use it. Your company needs it, so your manager may review this. Allow location for Crow HR in Android Settings → Apps → Crow HR → Permissions."
        !allowed -> "Sent without your location because Crow HR isn't allowed to use it."
        required -> "Sent without your location because the phone couldn't find it in time. Your company needs it, so your manager may review this. Check that location is on."
        else -> "Sent without your location because the phone couldn't find it in time."
    }
}
