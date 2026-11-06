package crowtech.crowhr.core

import crowtech.crowhr.security.KeyValueStore
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import java.time.Instant

@Serializable private data class CacheEntry(val savedAt: String, val json: String)

/**
 * The little offline screens need (spec: payslip list, leave balances, schedule), encrypted with
 * everything else and deleted on sign-out. Payslip details and PDFs are never cached.
 */
class LocalCache(private val kv: KeyValueStore) {
    private fun key(connectionKey: String, name: String) = "cache.$connectionKey.$name"

    fun <T> put(connectionKey: String, name: String, serializer: KSerializer<T>, value: T, now: Instant = Instant.now()) {
        val entry = CacheEntry(now.toString(), CrowJson.encodeToString(serializer, value))
        kv.put(key(connectionKey, name), CrowJson.encodeToString(CacheEntry.serializer(), entry))
    }

    /** The value and when it was saved ("2 Nov 2026, 08:58"). */
    fun <T> get(connectionKey: String, name: String, serializer: KSerializer<T>): Pair<T, String>? {
        val raw = kv.get(key(connectionKey, name)) ?: return null
        return runCatching {
            val entry = CrowJson.decodeFromString(CacheEntry.serializer(), raw)
            CrowJson.decodeFromString(serializer, entry.json) to Formats.dateTime(Instant.parse(entry.savedAt))
        }.getOrNull()
    }

    fun clear(connectionKey: String) {
        val prefix = "cache.$connectionKey."
        kv.keys().filter { it.startsWith(prefix) }.forEach(kv::remove)
    }
}
