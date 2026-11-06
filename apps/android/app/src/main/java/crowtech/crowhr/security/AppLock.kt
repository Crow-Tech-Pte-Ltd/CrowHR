package crowtech.crowhr.security

import java.time.Duration
import java.time.Instant

/**
 * Optional biometric unlock (spec "Native sign-in and session storage"): when on, the app asks
 * for BiometricPrompt (with device PIN/pattern fallback) on a cold start and when it returns
 * after more than [GRACE] in the background.
 */
class AppLock(private val kv: KeyValueStore) {
    companion object {
        val GRACE: Duration = Duration.ofMinutes(5)
        private const val ENABLED = "settings.biometricLock"
    }

    private var unlockedInProcess = false
    private var backgroundAt: Instant? = null

    var enabled: Boolean
        get() = kv.get(ENABLED) == "true"
        set(value) {
            kv.put(ENABLED, value.toString())
            if (value) unlockedInProcess = true
        }

    fun onBackground(now: Instant) { backgroundAt = now }

    fun onUnlocked() {
        unlockedInProcess = true
        backgroundAt = null
    }

    fun shouldLock(now: Instant): Boolean {
        if (!enabled) return false
        if (!unlockedInProcess) return true
        val since = backgroundAt ?: return false
        return now.isBefore(since) || Duration.between(since, now) > GRACE
    }
}
