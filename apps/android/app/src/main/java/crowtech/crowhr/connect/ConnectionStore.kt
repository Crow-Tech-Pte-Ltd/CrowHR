package crowtech.crowhr.connect

import crowtech.crowhr.core.CrowJson
import crowtech.crowhr.security.KeyValueStore
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer

@Serializable
data class SavedConnection(
    val server: String,
    val orgSlug: String,
    val displayName: String,
    val logoUrl: String? = null,
    val insecure: Boolean = false,
    val features: List<String> = emptyList(),
    val signInMethods: List<MetaSignInMethod> = emptyList(),
    val demo: Boolean = false,
) {
    val key: String get() = "$server|$orgSlug"
    fun isAvailable(screen: AppScreen) = screen.isAvailable(features)
}

/**
 * Up to [LIMIT] saved connections (spec "Up to 5 connections SHALL be saved and switchable"),
 * keyed by server + organisation. Kept in the encrypted store; contains no secrets itself.
 */
class ConnectionStore(private val kv: KeyValueStore) {
    companion object {
        const val LIMIT = 5
        private const val LIST = "connections.list"
        private const val ACTIVE = "connections.active"
    }

    enum class Result(val code: String) {
        Added("added"), Updated("updated"), TooMany("too_many_connections"), Switched("switched"),
        Removed("removed"), NotFound("not_found"),
    }

    private val serializer = ListSerializer(SavedConnection.serializer())

    @Synchronized fun all(): List<SavedConnection> =
        kv.get(LIST)?.let { runCatching { CrowJson.decodeFromString(serializer, it) }.getOrNull() } ?: emptyList()

    @Synchronized fun active(): SavedConnection? = kv.get(ACTIVE)?.let { key -> all().firstOrNull { it.key == key } }

    @Synchronized fun add(connection: SavedConnection): Result {
        val list = all().toMutableList()
        val index = list.indexOfFirst { it.key == connection.key }
        val result = when {
            index >= 0 -> { list[index] = connection; Result.Updated }
            list.size >= LIMIT -> return Result.TooMany
            else -> { list += connection; Result.Added }
        }
        save(list)
        kv.put(ACTIVE, connection.key)
        return result
    }

    /** Refreshes the stored meta details of an existing connection (features, name, methods). */
    @Synchronized fun update(connection: SavedConnection) {
        val list = all().toMutableList()
        val index = list.indexOfFirst { it.key == connection.key }
        if (index >= 0) { list[index] = connection; save(list) }
    }

    @Synchronized fun switchTo(key: String): Result {
        if (all().none { it.key == key }) return Result.NotFound
        kv.put(ACTIVE, key)
        return Result.Switched
    }

    @Synchronized fun remove(key: String): Result {
        val list = all()
        if (list.none { it.key == key }) return Result.NotFound
        save(list.filterNot { it.key == key })
        if (kv.get(ACTIVE) == key) kv.remove(ACTIVE)
        return Result.Removed
    }

    private fun save(list: List<SavedConnection>) = kv.put(LIST, CrowJson.encodeToString(serializer, list))
}
