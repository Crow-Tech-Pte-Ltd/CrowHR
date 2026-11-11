package crowtech.crowhr.api

import crowtech.crowhr.auth.NativeAuth
import crowtech.crowhr.auth.RefreshResult
import crowtech.crowhr.auth.TokenStore
import crowtech.crowhr.connect.SavedConnection
import crowtech.crowhr.connect.UrlCodec
import crowtech.crowhr.core.CrowJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationStrategy
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import javax.net.ssl.SSLException

@Serializable private data class ErrorEnvelope(val error: ErrorBody? = null)
@Serializable private data class ErrorBody(val code: String = "error", val message: String = "", val requestId: String? = null)

/** `{ error: { code, message } }` → [ApiException]; any other body gets a generic message. */
fun parseError(status: Int, body: String): ApiException {
    val e = runCatching { CrowJson.decodeFromString(ErrorEnvelope.serializer(), body).error }.getOrNull()
    val message = e?.message?.takeIf { it.isNotBlank() } ?: when (status) {
        401 -> "Your session has ended. Sign in again."
        403 -> "You don't have access to this."
        404 -> "This item was not found. It may have been removed."
        in 500..599 -> "The server had a problem. Try again in a moment."
        else -> "The server refused this request."
    }
    return ApiException(status, e?.code ?: "http_$status", message)
}

/** Raw response for callers that need the status and body (the punch queue). */
data class RawResponse(val status: Int, val body: String)

/**
 * Bearer-token client for one saved connection. Tokens only ever travel in the Authorization
 * header. A 401 triggers one refresh and one retry; if the refresh is refused the session has
 * ended ([onSessionEnded]: the app clears local data and returns to sign-in).
 */
class ApiClient(
    val connection: SavedConnection,
    private val http: OkHttpClient,
    private val tokens: TokenStore,
    private val auth: NativeAuth,
    private val onSessionEnded: (SavedConnection) -> Unit,
) {
    private val jsonType = "application/json".toMediaType()

    suspend fun <T> get(path: String, deserializer: DeserializationStrategy<T>, query: Map<String, String?> = emptyMap()): T =
        decode(deserializer, execute("GET", path + queryString(query), null))

    suspend fun <B, T> post(path: String, body: B, serializer: SerializationStrategy<B>, deserializer: DeserializationStrategy<T>): T =
        decode(deserializer, execute("POST", path, CrowJson.encodeToString(serializer, body).toRequestBody(jsonType)))

    suspend fun postEmpty(path: String) { execute("POST", path, ByteArray(0).toRequestBody(null)) }

    suspend fun <T> postEmpty(path: String, deserializer: DeserializationStrategy<T>): T =
        decode(deserializer, execute("POST", path, ByteArray(0).toRequestBody(null)))

    suspend fun <T> postBytes(path: String, bytes: ByteArray, contentType: String, deserializer: DeserializationStrategy<T>): T =
        decode(deserializer, execute("POST", path, bytes.toRequestBody(contentType.toMediaType())))

    suspend fun bytes(path: String): ByteArray = executeBytes("GET", path)

    /** Status and body without throwing on HTTP errors (401 is still refreshed first). */
    suspend fun raw(method: String, path: String, json: String?): RawResponse {
        val body = json?.toRequestBody(jsonType)
        return call(method, path, body, throwOnError = false).let { RawResponse(it.first, String(it.second, Charsets.UTF_8)) }
    }

    private fun queryString(query: Map<String, String?>): String {
        val parts = query.filterValues { it != null }.map { (k, v) -> "${UrlCodec.encode(k)}=${UrlCodec.encode(v!!)}" }
        return if (parts.isEmpty()) "" else "?" + parts.joinToString("&")
    }

    private fun <T> decode(deserializer: DeserializationStrategy<T>, bytes: ByteArray): T = try {
        CrowJson.decodeFromString(deserializer, String(bytes, Charsets.UTF_8))
    } catch (e: Exception) {
        throw ApiException(502, "bad_response", "The server sent an answer this app doesn't understand. Your server may need updating.")
    }

    private suspend fun execute(method: String, path: String, body: RequestBody?): ByteArray = call(method, path, body, true).second
    private suspend fun executeBytes(method: String, path: String): ByteArray = call(method, path, null, true).second

    private suspend fun call(method: String, path: String, body: RequestBody?, throwOnError: Boolean): Pair<Int, ByteArray> {
        val first = tokens.get(connection.key) ?: run {
            onSessionEnded(connection)
            throw ApiException(401, "session_ended", "Your session has ended. Sign in again.")
        }
        var result = send(method, path, body, first.accessToken)
        if (result.first == 401) {
            when (auth.refresh(connection, first.accessToken)) {
                RefreshResult.Refreshed -> {
                    val again = tokens.get(connection.key)
                    if (again != null) result = send(method, path, body, again.accessToken)
                }
                RefreshResult.Offline -> throw OfflineException("Couldn't reach the server to renew your session. Check your connection and try again.")
                RefreshResult.SessionEnded -> Unit
            }
            if (result.first == 401) {
                tokens.delete(connection.key)
                onSessionEnded(connection)
                throw ApiException(401, "session_ended", "Your session has ended. Sign in again.")
            }
        }
        if (throwOnError && result.first !in 200..299) throw parseError(result.first, String(result.second, Charsets.UTF_8))
        return result
    }

    private suspend fun send(method: String, path: String, body: RequestBody?, accessToken: String): Pair<Int, ByteArray> =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url(connection.server + path)
                .header("Authorization", "Bearer $accessToken")
                .header("Accept", "application/json")
                .method(method, body)
                .build()
            try {
                http.newCall(request).execute().use { r -> r.code to (r.body?.bytes() ?: ByteArray(0)) }
            } catch (e: SSLException) {
                throw TlsException(e)
            } catch (e: OfflineException) {
                throw e
            } catch (e: IOException) {
                throw OfflineException("You're offline or the server can't be reached. Try again when you have a connection.", e)
            }
        }
}
