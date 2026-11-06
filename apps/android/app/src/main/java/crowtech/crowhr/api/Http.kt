package crowtech.crowhr.api

import crowtech.crowhr.BuildConfig
import crowtech.crowhr.connect.HttpResult
import crowtech.crowhr.connect.MetaFetcher
import crowtech.crowhr.connect.ServerAddress
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.EventListener
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Proxy
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException

/** Thrown for every transport problem (no signal, DNS, timeouts, TLS). */
open class OfflineException(message: String, cause: Throwable? = null) : IOException(message, cause)

class TlsException(cause: Throwable) : OfflineException(
    "The server's security certificate could not be verified. Ask your administrator to check the server's HTTPS certificate.",
    cause,
)

/** The server answered with an error (`{ error: { code, message } }`). */
class ApiException(val status: Int, val code: String, override val message: String) : Exception(message)

/** A request to any host other than the configured server; never sent. */
class BlockedRequestException(host: String) : IOException("Blocked a request to $host: the app only talks to your company's Crow HR server.")

/**
 * Observes every connection the app's HTTP client makes. Production leaves [sink] null; the UI
 * tests install a recorder to prove the network allow-list (mobile-apps spec "Network
 * allow-list test").
 */
object NetworkObserver {
    @Volatile var sink: ((host: String, address: String) -> Unit)? = null

    val factory = EventListener.Factory { call ->
        object : EventListener() {
            override fun connectStart(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy) {
                sink?.invoke(call.request().url.host, inetSocketAddress.address?.hostAddress ?: inetSocketAddress.hostString)
            }

            override fun callStart(call: Call) {
                sink?.invoke(call.request().url.host, "")
            }
        }
    }
}

/**
 * Network interceptor (so it also sees redirects and retries): only [allowedHost], and plain
 * http only to private-range / .local hosts. Defence in depth behind the connect-time checks.
 */
class TransportPolicyInterceptor(allowedHost: String) : Interceptor {
    private val allowed = allowedHost.lowercase().removePrefix("[").removeSuffix("]")

    override fun intercept(chain: Interceptor.Chain): Response {
        val url = chain.request().url
        val host = url.host.lowercase()
        if (host != allowed) throw BlockedRequestException(host)
        if (!url.isHttps && !ServerAddress.isHttpAllowedHost(host)) throw BlockedRequestException(host)
        return chain.proceed(chain.request())
    }
}

object HttpClients {
    private val base: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .followRedirects(false)
            .followSslRedirects(false)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .callTimeout(90, TimeUnit.SECONDS)
            .eventListenerFactory(NetworkObserver.factory)
            .addInterceptor { chain ->
                chain.proceed(chain.request().newBuilder().header("User-Agent", "CrowHR-Android/${BuildConfig.VERSION_NAME}").build())
            }
            .build()
    }

    /** A client that can reach only [host]. Shares the connection pool with every other client. */
    fun forHost(host: String): OkHttpClient = base.newBuilder().addNetworkInterceptor(TransportPolicyInterceptor(host)).build()
}

/** Meta check during connect: a client restricted to the host being checked. */
class OkHttpMetaFetcher : MetaFetcher {
    override suspend fun fetch(url: String): HttpResult = withContext(Dispatchers.IO) {
        val parsed = url.toHttpUrlOrNull() ?: return@withContext HttpResult.NetworkFailure("unreachable")
        val client = HttpClients.forHost(parsed.host)
        try {
            client.newCall(Request.Builder().url(parsed).header("Accept", "application/json").build()).execute().use { r ->
                HttpResult.Response(r.code, r.header("Content-Type"), r.body?.string() ?: "")
            }
        } catch (e: SSLException) {
            android.util.Log.i("CrowHR", "meta check: TLS failure (${e.javaClass.simpleName})")
            HttpResult.NetworkFailure("tls_error")
        } catch (e: IOException) {
            // Exception class only: never the URL or any response content.
            android.util.Log.i("CrowHR", "meta check: unreachable (${e.javaClass.simpleName}: ${e.message?.take(120)})")
            HttpResult.NetworkFailure("unreachable")
        }
    }
}
