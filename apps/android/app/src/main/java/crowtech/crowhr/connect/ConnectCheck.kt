package crowtech.crowhr.connect

import crowtech.crowhr.core.CrowJson
import kotlinx.serialization.Serializable

/** `GET /api/v1/meta` (api-platform "Server meta endpoint"). Unknown fields are ignored. */
@Serializable
data class Meta(
    val serverVersion: String,
    val apiVersions: List<String>,
    val features: List<String> = emptyList(),
    val demo: Boolean = false,
    val orgSlugRequired: Boolean = false,
    val organisations: List<MetaOrganisation> = emptyList(),
)

@Serializable
data class MetaOrganisation(
    val slug: String,
    val displayName: String,
    val logoUrl: String? = null,
    val signInMethods: List<MetaSignInMethod> = emptyList(),
)

/** `kind` stays a string so a newer server's sign-in kinds never break decoding. */
@Serializable
data class MetaSignInMethod(val kind: String, val displayName: String)

/** Screens and the meta features they need (connect-cases.json "featureGates"). */
/**
 * [requires]: what a server from before Nov 2026 must list (its meta advertised only `leave` and
 * `attendance.offlinePunch`; everything else was baseline). [feature]: the module key current
 * servers list for this screen. connect-cases.json "featureGates" and "modernGating".
 */
enum class AppScreen(val id: String, val label: String, val requires: List<String>, val feature: String) {
    Payslips("payslips", "Payslips", emptyList(), "payslips"),
    Leave("leave", "Leave", listOf("leave"), "leave"),
    Clock("clock", "Clock in", listOf("attendance.offlinePunch"), "attendance.offlinePunch"),
    Claims("claims", "Claims", emptyList(), "claims"),
    Schedule("schedule", "Schedule", emptyList(), "scheduling"),
    Approvals("approvals", "Approvals", emptyList(), "approvals"),
    Notifications("notifications", "Notifications", emptyList(), "notifications");

    /**
     * A server that lists any of the per-module keys ([MODERN_MARKERS]) is gated strictly on
     * [feature]; an older server (none of them listed) falls back to [requires].
     */
    fun isAvailable(features: List<String>) =
        if (features.any { it in MODERN_MARKERS }) feature in features else requires.all { it in features }

    companion object {
        val MODERN_MARKERS = setOf("payslips", "claims", "scheduling", "approvals", "notifications")
    }

    /** Shown in Settings when the server is too old for this screen. */
    val unavailableNotice: String get() = ConnectMessages.featureUnavailable(label)
}

sealed interface HttpResult {
    data class Response(val status: Int, val contentType: String?, val body: String) : HttpResult
    /** kind: "unreachable" | "tls_error" | "timeout" */
    data class NetworkFailure(val kind: String) : HttpResult
}

fun interface MetaFetcher {
    suspend fun fetch(url: String): HttpResult
}

sealed interface ConnectOutcome {
    val code: String

    data class Ok(
        val server: String,
        val insecure: Boolean,
        val org: MetaOrganisation,
        val features: List<String>,
        val demo: Boolean,
        val serverVersion: String,
    ) : ConnectOutcome {
        override val code get() = "ok"
        val hiddenScreens: List<AppScreen> get() = AppScreen.entries.filterNot { it.isAvailable(features) }
        val featureNotices: List<String> get() = hiddenScreens.map { it.unavailableNotice }
    }

    data class Failed(override val code: String, val server: String?) : ConnectOutcome {
        override val message: String get() = ConnectMessages.forCode(code)
    }

    val message: String? get() = null
}

object ConnectMessages {
    private val messages = mapOf(
        "invalid_url" to "Enter your company's Crow HR address, such as hr.yourcompany.com.",
        "credentials_in_url" to "Remove the user name and password from the address. Crow HR asks you to sign in after connecting.",
        "https_required" to "This address uses http://, which is not encrypted. Crow HR needs https:// for addresses on the internet. Ask HR for the https:// address.",
        "insecure_warning" to "This connection is not encrypted. Only continue on your company's own network.",
        "unreachable" to "Could not reach the server. Check your internet connection and the address, then try again.",
        "tls_error" to "The server's security certificate could not be verified, so the app did not connect. Ask your administrator to check the server's HTTPS certificate.",
        "not_crowhr" to "Could not find Crow HR at this address. Check the address with HR.",
        "app_too_old" to "Your company's Crow HR server is newer than this app. Update the Crow HR app to connect.",
        "server_too_old" to "Your company's Crow HR server is older than this app. Ask your administrator to upgrade Crow HR.",
        "org_required" to "This server hosts more than one organisation. Scan the QR code from Crow HR on the web (My profile → Mobile app) to connect.",
        "org_not_found" to "This server has no organisation with that code. Scan the QR code from Crow HR on the web (My profile → Mobile app).",
        "no_sign_in_methods" to "Your organisation has not enabled any sign-in method yet. Ask HR to check Settings → Security.",
        "too_many_connections" to "You can save up to 5 connections. Remove one before adding another.",
        // Android-only: Android 17's local network permission was refused.
        "local_network_denied" to "Crow HR needs permission to reach devices on your local network, because your company's server is on this network. Allow it when asked, or in Settings → Apps → Crow HR → Permissions.",
        // Android-only: a scanned code that is not a Crow HR connect code.
        "invalid_qr" to "This QR code is not a Crow HR code. In Crow HR on the web, open My profile → Mobile app and scan the code shown there.",
    )

    val insecureWarning: String get() = messages.getValue("insecure_warning")
    fun forCode(code: String): String = messages[code] ?: messages.getValue("unreachable")
    fun featureUnavailable(label: String) =
        "Your company's Crow HR server is older than this app. $label is available after your administrator upgrades."
}

/** Normalises the address, reads meta and decides whether this app can use the server. */
class ConnectCheck(private val fetcher: MetaFetcher) {
    companion object {
        val SUPPORTED_API_VERSIONS = listOf("v1")
    }

    suspend fun check(input: String, org: String?): ConnectOutcome {
        val address = when (val r = ServerAddress.normalize(input)) {
            is ServerAddress.Result.Error -> return ConnectOutcome.Failed(r.code, null)
            is ServerAddress.Result.Ok -> r
        }
        val failed = { code: String -> ConnectOutcome.Failed(code, address.base) }
        val response = when (val r = fetcher.fetch(ServerAddress.metaUrl(address.base, org))) {
            is HttpResult.NetworkFailure -> return failed(if (r.kind == "tls_error") "tls_error" else "unreachable")
            is HttpResult.Response -> r
        }
        if (response.status >= 500 || response.status == 408 || response.status == 429) return failed("unreachable")
        if (response.status != 200) return failed("not_crowhr")
        val meta = runCatching { CrowJson.decodeFromString(Meta.serializer(), response.body) }.getOrNull()
            ?: return failed("not_crowhr")
        if (SUPPORTED_API_VERSIONS.none { it in meta.apiVersions }) {
            val newest = meta.apiVersions.mapNotNull { it.removePrefix("v").toIntOrNull() }.maxOrNull()
            val ours = SUPPORTED_API_VERSIONS.mapNotNull { it.removePrefix("v").toIntOrNull() }.max()
            return failed(if (newest != null && newest > ours) "app_too_old" else "server_too_old")
        }
        val organisation = when {
            org != null -> meta.organisations.firstOrNull { it.slug == org } ?: return failed("org_not_found")
            meta.orgSlugRequired -> return failed("org_required")
            else -> meta.organisations.singleOrNull() ?: return failed(if (meta.organisations.isEmpty()) "org_not_found" else "org_required")
        }
        if (organisation.signInMethods.isEmpty()) return failed("no_sign_in_methods")
        return ConnectOutcome.Ok(
            server = address.base,
            insecure = address.insecure,
            org = organisation,
            features = meta.features,
            demo = meta.demo,
            serverVersion = meta.serverVersion,
        )
    }
}
