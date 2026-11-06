package crowtech.crowhr.auth

import crowtech.crowhr.core.CrowJson
import crowtech.crowhr.security.KeyValueStore
import kotlinx.serialization.Serializable

/** Opaque tokens from `POST /api/v1/native/token`. */
@Serializable
data class StoredTokens(
    val accessToken: String,
    val refreshToken: String,
    val deviceSessionId: String,
)

/** Tokens per saved connection, inside the Keystore-encrypted store only. */
class TokenStore(private val kv: KeyValueStore) {
    private fun key(connectionKey: String) = "tokens.$connectionKey"

    fun get(connectionKey: String): StoredTokens? =
        kv.get(key(connectionKey))?.let { runCatching { CrowJson.decodeFromString(StoredTokens.serializer(), it) }.getOrNull() }

    fun put(connectionKey: String, tokens: StoredTokens) =
        kv.put(key(connectionKey), CrowJson.encodeToString(StoredTokens.serializer(), tokens))

    fun delete(connectionKey: String) = kv.remove(key(connectionKey))
}
