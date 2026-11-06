package crowtech.crowhr.connect

import java.net.Inet6Address
import java.net.InetAddress
import java.net.URI

/**
 * Server address rules (connect-cases.json "urlRules"): HTTPS is required; plain HTTP only for
 * private-range IP addresses and .local hosts, after a warning.
 */
object ServerAddress {
    sealed interface Result {
        /** [base] is the normalised server address without a trailing slash. */
        data class Ok(val base: String, val host: String, val insecure: Boolean) : Result
        data class Error(val code: String) : Result
    }

    private val SCHEME_WITH_AUTHORITY = Regex("^([A-Za-z][A-Za-z0-9+.-]*)://")
    private val SCHEME_ONLY = Regex("^([A-Za-z][A-Za-z0-9+.-]*):(.*)$")

    fun normalize(input: String): Result {
        val trimmed = input.trim()
        if (trimmed.isEmpty() || trimmed.any { it.isWhitespace() }) return Result.Error("invalid_url")
        val withScheme = when {
            SCHEME_WITH_AUTHORITY.containsMatchIn(trimmed) -> trimmed
            else -> {
                // "javascript:x" or "mailto:x" is a scheme; "host:8443" is a host with a port.
                val m = SCHEME_ONLY.matchEntire(trimmed)
                if (m != null && !m.groupValues[2].matches(Regex("^\\d+(/.*)?$"))) return Result.Error("invalid_url")
                "https://$trimmed"
            }
        }
        val uri = try {
            URI(withScheme)
        } catch (_: Exception) {
            return Result.Error("invalid_url")
        }
        val scheme = uri.scheme?.lowercase() ?: return Result.Error("invalid_url")
        if (scheme != "https" && scheme != "http") return Result.Error("invalid_url")
        if (uri.rawUserInfo != null) return Result.Error("credentials_in_url")
        val host = uri.host?.lowercase()?.takeIf { it.isNotEmpty() } ?: return Result.Error("invalid_url")
        val port = if (uri.port == -1) "" else ":${uri.port}"
        val path = (uri.rawPath ?: "").trimEnd('/')
        val base = "$scheme://$host$port$path"
        if (scheme == "http" && !isHttpAllowedHost(host)) return Result.Error("https_required")
        return Result.Ok(base, host, insecure = scheme == "http")
    }

    fun metaUrl(base: String, org: String?): String =
        "$base/api/v1/meta" + (org?.let { "?org=${UrlCodec.encode(it)}" } ?: "")

    /** Hosts where plain HTTP is tolerated (with a warning): private ranges, loopback, .local. */
    fun isHttpAllowedHost(rawHost: String): Boolean {
        val host = rawHost.lowercase().removePrefix("[").removeSuffix("]")
        if (host == "localhost" || host.endsWith(".local")) return true
        ipv4(host)?.let { (a, b) ->
            return a == 10 || a == 127 || (a == 172 && b in 16..31) || (a == 192 && b == 168) || (a == 169 && b == 254)
        }
        if (host.contains(':') && host.all { it.isLetterOrDigit() || it == ':' || it == '.' }) {
            // An IPv6 literal: InetAddress parses literals without any DNS lookup.
            val address = runCatching { InetAddress.getByName(host) }.getOrNull() as? Inet6Address ?: return false
            val first = address.address[0].toInt() and 0xFF
            return address.isLoopbackAddress || address.isLinkLocalAddress || (first and 0xFE) == 0xFC
        }
        return false
    }

    private fun ipv4(host: String): Pair<Int, Int>? {
        val parts = host.split('.')
        if (parts.size != 4) return null
        val octets = parts.map { p -> p.toIntOrNull()?.takeIf { p.isNotEmpty() && p.all(Char::isDigit) && it in 0..255 } ?: return null }
        return octets[0] to octets[1]
    }
}

/** RFC 3986 percent-encoding and decoding ('+' is a literal plus, not a space). */
object UrlCodec {
    private const val UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"

    fun encode(value: String): String {
        val out = StringBuilder()
        for (b in value.toByteArray(Charsets.UTF_8)) {
            val c = (b.toInt() and 0xFF).toChar()
            if (c in UNRESERVED) out.append(c) else out.append('%').append("%02X".format(b.toInt() and 0xFF))
        }
        return out.toString()
    }

    /** Returns null for malformed escapes. */
    fun decode(value: String): String? {
        val bytes = java.io.ByteArrayOutputStream()
        var i = 0
        while (i < value.length) {
            val c = value[i]
            if (c == '%') {
                val hex = value.substring(i + 1, minOf(i + 3, value.length))
                if (hex.length != 2) return null
                bytes.write(hex.toIntOrNull(16) ?: return null)
                i += 3
            } else {
                bytes.write(c.toString().toByteArray(Charsets.UTF_8))
                i++
            }
        }
        return bytes.toString(Charsets.UTF_8.name())
    }
}
