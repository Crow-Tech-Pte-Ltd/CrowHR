package crowtech.crowhr.auth

import crowtech.crowhr.api.ApiException
import crowtech.crowhr.api.OfflineException
import crowtech.crowhr.api.parseError
import crowtech.crowhr.connect.DeepLinks
import crowtech.crowhr.connect.SavedConnection
import crowtech.crowhr.connect.UrlCodec
import crowtech.crowhr.core.CrowJson
import crowtech.crowhr.security.KeyValueStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.time.Instant

@Serializable
data class PendingSignIn(
    val connectionKey: String,
    val verifier: String,
    val state: String,
)

@Serializable
private data class TokenResponse(
    val accessToken: String,
    val refreshToken: String,
    val deviceSessionId: String,
    val expiresIn: Int = 900,
) {
    /** [asked]: when the request was sent, so the expiry errs early. */
    fun stored(asked: Instant) = StoredTokens(accessToken, refreshToken, deviceSessionId, asked.toEpochMilli() + expiresIn * 1_000L)
}

@Serializable
private data class CodeGrant(
    val grantType: String = "authorization_code",
    val code: String,
    val codeVerifier: String,
    val deviceName: String,
    val appVersion: String,
)

@Serializable
private data class RefreshGrant(val grantType: String = "refresh_token", val refreshToken: String)

sealed interface SignInResult {
    data class Success(val connectionKey: String) : SignInResult
    data class Failed(val message: String) : SignInResult
}

enum class RefreshResult { Refreshed, SessionEnded, Offline }

/**
 * Native sign-in (RFC 8252): the server's own sign-in page in the system browser (Custom Tabs),
 * PKCE S256 and a random state, then a one-time code exchanged for opaque tokens.
 * Any sign-in method the organisation enabled works, because the browser does the signing in.
 */
class NativeAuth(
    private val kv: KeyValueStore,
    private val tokens: TokenStore,
    private val httpFor: (SavedConnection) -> OkHttpClient,
    private val deviceName: String,
    private val appVersion: String,
    private val now: () -> Instant = Instant::now,
) {
    companion object {
        const val REDIRECT_URI = DeepLinks.REDIRECT_URI
        private const val PENDING = "auth.pending"
        private val JSON = "application/json".toMediaType()

        fun authorizeUrl(server: String, org: String, client: String, redirectUri: String, challenge: String, state: String): String =
            "$server/api/v1/native/authorize" +
                "?org=${UrlCodec.encode(org)}" +
                "&client=${UrlCodec.encode(client)}" +
                "&redirect_uri=${UrlCodec.encode(redirectUri)}" +
                "&code_challenge=${UrlCodec.encode(challenge)}" +
                "&code_challenge_method=S256" +
                "&state=${UrlCodec.encode(state)}"

        /** "Pixel 9 (Android)": shown in My sessions on the web; at most 60 characters. */
        fun deviceName(manufacturer: String, model: String): String {
            val maker = manufacturer.trim().replaceFirstChar { it.uppercase() }
            val name = if (model.startsWith(manufacturer, ignoreCase = true) || maker.equals("Google", true)) model.trim() else "$maker ${model.trim()}"
            val suffix = " (Android)"
            return name.take(60 - suffix.length).trim() + suffix
        }
    }

    private val refreshLock = Mutex()

    /**
     * Only Crow HR refusing the refresh token (a 4xx with its JSON error, such as invalid_grant)
     * ends the session. A rate limit or timeout, or a 4xx page from a proxy, firewall or captive
     * portal in front of the server (no Crow HR error body: parseError's "http_" codes), is
     * temporary and keeps the tokens.
     */
    private fun endsSession(e: ApiException): Boolean =
        e.status in 400..499 && e.status != 408 && e.status != 425 && e.status != 429 && !e.code.startsWith("http_")

    fun pending(): PendingSignIn? = kv.get(PENDING)?.let { runCatching { CrowJson.decodeFromString(PendingSignIn.serializer(), it) }.getOrNull() }

    /** Starts a sign-in; the returned URL is opened in the system browser. */
    fun begin(connection: SavedConnection): String {
        val pkce = Pkce.generate()
        val state = Pkce.newState()
        kv.put(PENDING, CrowJson.encodeToString(PendingSignIn.serializer(), PendingSignIn(connection.key, pkce.verifier, state)))
        return authorizeUrl(connection.server, connection.orgSlug, "android", REDIRECT_URI, pkce.challenge, state)
    }

    fun cancel() = kv.remove(PENDING)

    /** Handles `crowtech.crowhr:/oauth2redirect?…`. A wrong state never exchanges anything. */
    suspend fun complete(redirect: String, connectionFor: (String) -> SavedConnection?): SignInResult {
        val pending = pending()
        return when (val parsed = DeepLinks.parseOAuthRedirect(redirect, pending?.state)) {
            DeepLinks.Redirect.StateMismatch, DeepLinks.Redirect.Invalid ->
                SignInResult.Failed("This sign-in link didn't come from the sign-in you started. Tap Sign in to try again.")
            is DeepLinks.Redirect.Error -> {
                cancel()
                SignInResult.Failed(
                    if (parsed.error == "access_denied") "Sign-in was cancelled." else "Sign-in didn't finish (${parsed.error}). Try again.",
                )
            }
            is DeepLinks.Redirect.Code -> {
                pending!!
                cancel() // single use, whatever happens next
                val connection = connectionFor(pending.connectionKey)
                    ?: return SignInResult.Failed("This connection was removed. Add it again.")
                try {
                    val body = CrowJson.encodeToString(CodeGrant.serializer(), CodeGrant(code = parsed.code, codeVerifier = pending.verifier, deviceName = deviceName, appVersion = appVersion))
                    val asked = now()
                    val response = postToken(connection, body)
                    tokens.put(connection.key, response.stored(asked))
                    SignInResult.Success(connection.key)
                } catch (e: ApiException) {
                    SignInResult.Failed(e.message)
                } catch (e: IOException) {
                    SignInResult.Failed("Could not reach the server to finish signing in. Check your connection and sign in again.")
                }
            }
        }
    }

    /**
     * Rotates the refresh token. Only one refresh runs at a time; a caller that waited and finds
     * the access token already replaced skips its own refresh.
     */
    suspend fun refresh(connection: SavedConnection, staleAccessToken: String?): RefreshResult = refreshLock.withLock {
        val current = tokens.get(connection.key) ?: return RefreshResult.SessionEnded
        if (staleAccessToken != null && current.accessToken != staleAccessToken) return RefreshResult.Refreshed
        try {
            val asked = now()
            val r = postToken(connection, CrowJson.encodeToString(RefreshGrant.serializer(), RefreshGrant(refreshToken = current.refreshToken)))
            tokens.put(connection.key, r.stored(asked))
            RefreshResult.Refreshed
        } catch (e: ApiException) {
            if (endsSession(e)) {
                tokens.delete(connection.key)
                RefreshResult.SessionEnded
            } else {
                RefreshResult.Offline
            }
        } catch (e: IOException) {
            RefreshResult.Offline
        }
    }

    /** Revokes the device session on the server (best effort) and always deletes the tokens. */
    suspend fun signOut(connection: SavedConnection) {
        val current = tokens.get(connection.key)
        tokens.delete(connection.key)
        if (current == null) return
        withContext(Dispatchers.IO) {
            runCatching {
                httpFor(connection).newCall(
                    Request.Builder().url("${connection.server}/api/v1/native/revoke")
                        .header("Authorization", "Bearer ${current.accessToken}")
                        .post(ByteArray(0).toRequestBody(null))
                        .build(),
                ).execute().close()
            }
        }
    }

    private suspend fun postToken(connection: SavedConnection, json: String): TokenResponse = withContext(Dispatchers.IO) {
        val request = Request.Builder().url("${connection.server}/api/v1/native/token")
            .header("Accept", "application/json")
            .post(json.toRequestBody(JSON))
            .build()
        try {
            httpFor(connection).newCall(request).execute().use { r ->
                val text = r.body?.string() ?: ""
                if (!r.isSuccessful) throw parseError(r.code, text)
                runCatching { CrowJson.decodeFromString(TokenResponse.serializer(), text) }
                    .getOrElse { throw ApiException(502, "bad_response", "The server sent an unexpected answer. Try again.") }
            }
        } catch (e: IOException) {
            throw OfflineException("Could not reach the server.", e)
        }
    }
}
