package crowtech.crowhr.auth

import crowtech.crowhr.core.CrowJson
import crowtech.crowhr.security.KeyValueStore
import kotlinx.serialization.Serializable
import java.time.Instant

/** Opaque tokens from `POST /api/v1/native/token`. */
@Serializable
data class StoredTokens(
    val accessToken: String,
    val refreshToken: String,
    val deviceSessionId: String,
    /**
     * When the access token expires (phone clock, from the reply's `expiresIn`), so it is renewed
     * a minute early, as on iOS. Null for tokens stored by earlier versions: renewed on a 401.
     */
    val accessExpiresAtEpochMs: Long? = null,
) {
    fun needsRefresh(now: Instant): Boolean =
        accessExpiresAtEpochMs != null && now.toEpochMilli() + REFRESH_EARLY_MS >= accessExpiresAtEpochMs

    companion object {
        const val REFRESH_EARLY_MS = 60_000L
    }
}

/** Tokens per saved connection, inside the Keystore-encrypted store only. */
class TokenStore(private val kv: KeyValueStore) {
    private fun key(connectionKey: String) = "tokens.$connectionKey"

    fun get(connectionKey: String): StoredTokens? =
        kv.get(key(connectionKey))?.let { runCatching { CrowJson.decodeFromString(StoredTokens.serializer(), it) }.getOrNull() }

    fun put(connectionKey: String, tokens: StoredTokens) =
        kv.put(key(connectionKey), CrowJson.encodeToString(StoredTokens.serializer(), tokens))

    fun delete(connectionKey: String) = kv.remove(key(connectionKey))
}
