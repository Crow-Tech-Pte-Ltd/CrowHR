package crowtech.crowhr.security

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration
import java.time.Instant

/** Spec: with biometric unlock on, the app asks again after more than 5 minutes in the background. */
class AppLockTest {
    private val t0 = Instant.parse("2026-11-02T01:00:00Z")

    @Test fun offByDefaultNeverLocks() {
        val lock = AppLock(InMemoryKeyValueStore())
        lock.onBackground(t0)
        assertFalse(lock.shouldLock(t0.plus(Duration.ofHours(3))))
    }

    @Test fun locksOnColdStartWhenOn() {
        val kv = InMemoryKeyValueStore()
        AppLock(kv).enabled = true
        assertTrue(AppLock(kv).shouldLock(t0))
    }

    @Test fun fiveMinutesIsTheThreshold() {
        val lock = AppLock(InMemoryKeyValueStore())
        lock.enabled = true
        lock.onUnlocked()
        lock.onBackground(t0)
        assertFalse(lock.shouldLock(t0.plus(Duration.ofMinutes(5))))
        assertTrue(lock.shouldLock(t0.plus(Duration.ofMinutes(5)).plusSeconds(1)))
    }

    @Test fun unlockingClearsTheLock() {
        val lock = AppLock(InMemoryKeyValueStore())
        lock.enabled = true
        lock.onBackground(t0)
        assertTrue(lock.shouldLock(t0.plus(Duration.ofMinutes(10))))
        lock.onUnlocked()
        assertFalse(lock.shouldLock(t0.plus(Duration.ofMinutes(10))))
    }

    @Test fun aClockSetBackwardsLocks() {
        val lock = AppLock(InMemoryKeyValueStore())
        lock.enabled = true
        lock.onUnlocked()
        lock.onBackground(t0)
        assertTrue(lock.shouldLock(t0.minus(Duration.ofMinutes(1))))
    }
}
