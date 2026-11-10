package crowtech.crowhr.connect

/**
 * Deep links (deeplink-cases.json): the QR / link from the web app and the native sign-in
 * callback. Parsed by hand (not android.net.Uri) so the rules are identical in unit tests.
 */
object DeepLinks {
    const val REDIRECT_URI = "crowtech.crowhr:/oauth2redirect"
    private const val REDIRECT_SCHEME = "crowtech.crowhr"
    private const val REDIRECT_PATH = "/oauth2redirect"
    private val ORG = Regex("^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$")

    /** An organisation ID (slug) as the server issues them: lower-case letters, digits and hyphens. */
    fun isValidOrgSlug(slug: String): Boolean = ORG.matches(slug)
    private val HIERARCHICAL = Regex("^([A-Za-z][A-Za-z0-9+.-]*)://([^/?#]*)([^?#]*)(?:\\?([^#]*))?(?:#.*)?$")

    sealed interface Connect {
        data class Ok(val server: String, val org: String?) : Connect
        data object Invalid : Connect
    }

    sealed interface Redirect {
        data class Code(val code: String) : Redirect
        data class Error(val error: String) : Redirect
        data object StateMismatch : Redirect
        data object Invalid : Redirect
    }

    /** `crowhr://connect?server=<url>&org=<slug>` */
    fun parseConnect(uri: String): Connect {
        val m = HIERARCHICAL.matchEntire(uri.trim()) ?: return Connect.Invalid
        val (scheme, host, path, query) = m.destructured
        if (!scheme.equals("crowhr", ignoreCase = true) || !host.equals("connect", ignoreCase = true)) return Connect.Invalid
        if (path != "" && path != "/") return Connect.Invalid
        val params = queryParams(query) ?: return Connect.Invalid
        val servers = params.filter { it.first == "server" }.map { it.second }
        val orgs = params.filter { it.first == "org" }.map { it.second }
        if (servers.size != 1 || orgs.size > 1) return Connect.Invalid
        val server = servers.single().trim()
        val lower = server.lowercase()
        val afterScheme = when {
            lower.startsWith("https://") -> server.substring(8)
            lower.startsWith("http://") -> server.substring(7)
            else -> return Connect.Invalid
        }
        if (afterScheme.isBlank()) return Connect.Invalid
        val org = orgs.singleOrNull()?.lowercase()
        if (org != null && !ORG.matches(org)) return Connect.Invalid
        return Connect.Ok(server, org)
    }

    fun isOAuthRedirect(uri: String): Boolean = uri.substringBefore(':').equals(REDIRECT_SCHEME, ignoreCase = true)

    /** `crowtech.crowhr:/oauth2redirect?code=…&state=…`; [expectedState] null = no sign-in pending. */
    fun parseOAuthRedirect(uri: String, expectedState: String?): Redirect {
        val colon = uri.indexOf(':')
        if (colon <= 0 || !uri.substring(0, colon).equals(REDIRECT_SCHEME, ignoreCase = true)) return Redirect.Invalid
        val rest = uri.substring(colon + 1)
        if (!rest.startsWith(REDIRECT_PATH)) return Redirect.Invalid
        val tail = rest.substring(REDIRECT_PATH.length)
        if (tail.isNotEmpty() && !tail.startsWith("?")) return Redirect.Invalid
        val params = queryParams(tail.removePrefix("?").substringBefore('#')) ?: return Redirect.Invalid
        fun param(name: String) = params.firstOrNull { it.first == name }?.second
        val state = param("state")
        if (expectedState == null || state == null || !constantTimeEquals(state, expectedState)) return Redirect.StateMismatch
        param("error")?.let { return Redirect.Error(it) }
        val code = param("code")?.takeIf { it.isNotEmpty() } ?: return Redirect.Invalid
        return Redirect.Code(code)
    }

    private fun queryParams(query: String): List<Pair<String, String>>? {
        if (query.isEmpty()) return emptyList()
        return query.split('&').filter { it.isNotEmpty() }.map { part ->
            val key = UrlCodec.decode(part.substringBefore('=')) ?: return null
            val value = if (part.contains('=')) UrlCodec.decode(part.substringAfter('=')) ?: return null else ""
            key to value
        }
    }

    private fun constantTimeEquals(a: String, b: String): Boolean =
        java.security.MessageDigest.isEqual(a.toByteArray(), b.toByteArray())
}
