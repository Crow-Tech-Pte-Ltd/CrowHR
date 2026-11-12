package crowtech.crowhr.ui

import androidx.compose.runtime.staticCompositionLocalOf
import java.util.concurrent.ConcurrentHashMap

/**
 * The last content each tab loaded, per connection, in memory only (never written anywhere), so
 * going back to a tab shows it at once while it loads again, as iOS does. Before, every tab
 * switch dropped the screen's data and showed the full-screen spinner. Cleared when the session
 * ends or the user signs out ([crowtech.crowhr.AppGraph.clearSession]). Payslip details are never
 * kept here.
 */
class ScreenMemory {
    private val values = ConcurrentHashMap<String, Any>()

    fun get(key: String): Any? = values[key]

    fun put(key: String, value: Any) {
        values[key] = value
    }

    /** Everything kept for one connection. */
    fun clear(connectionKey: String) {
        val prefix = connectionKey + SEPARATOR
        values.keys.removeIf { it.startsWith(prefix) }
    }

    fun clearAll() = values.clear()

    companion object {
        private const val SEPARATOR = '\u0000'

        /** The key for one screen's content on one connection. */
        fun key(connectionKey: String, name: String) = connectionKey + SEPARATOR + name
    }
}

/** Provided by the main shell; null elsewhere (nothing is remembered). */
val LocalScreenMemory = staticCompositionLocalOf<ScreenMemory?> { null }
