package crowtech.crowhr

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.test.platform.app.InstrumentationRegistry
import crowtech.crowhr.auth.BrowserLauncher
import crowtech.crowhr.auth.Pkce
import crowtech.crowhr.ui.ReceiptCamera
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.FileOutputStream
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.concurrent.thread

/**
 * The local seeded Crow HR server (scripts/android-test-server.sh, e2e/seed.ts) as seen from
 * the emulator. This harness plays the system browser during sign-in and prepares fixture data
 * through the same public API; it uses its own HTTP client, separate from the app's.
 */
object TestServer {
    val base: String = InstrumentationRegistry.getArguments().getString("crowhrServer") ?: "http://10.0.2.2:3197"
    val host: String = base.toHttpUrl().host
    const val ORG = "kampong-kopi"
    const val PASSWORD = "kopi peng siew dai 2026"
    const val NADIA = "nadia@kampongkopi.example"
    const val KAIWEN = "kaiwen@kampongkopi.example"
    const val AHMAD = "ahmad@kampongkopi.example"
    const val NURUL = "nurul@kampongkopi.example"
    const val OWNER = "owner@kampongkopi.example"
    const val PAYROLL = "payroll@kampongkopi.example"

    val connectLink: String get() = "crowhr://connect?server=${Uri.encode(base)}&org=$ORG"

    private val http = OkHttpClient.Builder().followRedirects(false).build()
    private val json = "application/json".toMediaType()
    private val tokens = HashMap<String, String>()

    data class Reply(val status: Int, val body: JsonElement)

    fun call(method: String, path: String, token: String?, body: JsonElement? = null): Reply {
        val b = Request.Builder().url(base + path)
        token?.let { b.header("Authorization", "Bearer $it") }
        val rb = when {
            body != null -> body.toString().toRequestBody(json)
            method == "POST" || method == "PUT" -> ByteArray(0).toRequestBody(null)
            else -> null
        }
        http.newCall(b.method(method, rb).build()).execute().use { r ->
            val text = r.body?.string().orEmpty()
            return Reply(r.code, if (text.isBlank()) JsonNull else runCatching { Json.parseToJsonElement(text) }.getOrElse { JsonPrimitive(text) })
        }
    }

    fun get(path: String, token: String) = call("GET", path, token).also { check(it.status in 200..299) { "GET $path → ${it.status} ${it.body}" } }.body
    fun post(path: String, token: String, body: JsonElement? = null) = call("POST", path, token, body).also { check(it.status in 200..299) { "POST $path → ${it.status} ${it.body}" } }.body

    /** What the system browser does: follow /native/authorize to the sign-in page and sign in with a password. */
    fun signInInBrowser(authorizeUrl: String, email: String): String {
        val location = http.newCall(Request.Builder().url(authorizeUrl).build()).execute().use { r ->
            check(r.code == 302) { "authorize → ${r.code}" }
            r.header("Location")!!
        }
        val requestId = location.substringAfter("native=")
        val reply = call("POST", "/api/v1/auth/sign-in", null, buildJsonObject {
            put("org", ORG); put("email", email); put("password", PASSWORD); put("nativeRequestId", requestId)
        })
        check(reply.status == 200) { "sign-in → ${reply.status} ${reply.body}" }
        return reply.body.jsonObject["redirectTo"]!!.jsonPrimitive.content
    }

    /** A bearer token for fixture setup (its own device session, like a second phone). */
    fun token(email: String): String = tokens.getOrPut(email) {
        val pkce = Pkce.generate()
        val url = "$base/api/v1/native/authorize?org=$ORG&client=android&redirect_uri=${Uri.encode("crowtech.crowhr:/oauth2redirect")}" +
            "&code_challenge=${pkce.challenge}&code_challenge_method=S256&state=${Pkce.newState()}"
        val redirect = signInInBrowser(url, email)
        val code = Uri.parse(redirect).getQueryParameter("code")!!
        post("/api/v1/native/token", "", buildJsonObject {
            put("grantType", "authorization_code"); put("code", code); put("codeVerifier", pkce.verifier); put("deviceName", "Test harness")
        }).jsonObject["accessToken"]!!.jsonPrimitive.content
    }

    fun forget(email: String) { tokens.remove(email) }

    private fun JsonElement.items(): JsonArray = (this as? JsonObject)?.get("items")?.jsonArray ?: jsonArray

    /** Nadia gets a released payslip: last month's run, computed, approved by the owner, released. */
    fun ensureReleasedPayslip(): JsonObject {
        get("/api/v1/payslips", token(NADIA)).items().firstOrNull()?.let { return it.jsonObject }
        val owner = token(OWNER)
        val payroll = token(PAYROLL)
        call("PUT", "/api/v1/organisation/profile", owner, buildJsonObject {
            put("legalName", "Kampong Kopi Pte. Ltd."); put("uen", "202600001K"); put("csn", "202600001KPTE01")
            put("addressBlock", "1"); put("addressStreet", "Kampong Bahru Road"); put("postalCode", "169341")
        })
        val month = LocalDate.now(ZoneId.of("Asia/Singapore")).minusMonths(1).toString().take(7)
        val run = post("/api/v1/payroll/runs", payroll, buildJsonObject { put("kind", "regular"); put("month", month) }).jsonObject["id"]!!.jsonPrimitive.content
        post("/api/v1/payroll/runs/$run/compute", payroll)
        post("/api/v1/payroll/runs/$run/submit", payroll)
        val task = get("/api/v1/approvals/tasks", owner).items().first { it.jsonObject["subjectType"]!!.jsonPrimitive.content == "payroll_run" }
        post("/api/v1/approvals/tasks/${task.jsonObject["taskId"]!!.jsonPrimitive.content}/decision", owner, buildJsonObject { put("decision", "approve") })
        post("/api/v1/payroll/runs/$run/release", payroll)
        return get("/api/v1/payslips", token(NADIA)).items().first().jsonObject
    }

    /** Nurul gets a published 09:00–17:00 shift next Monday at her location. */
    fun ensurePublishedShift(): String {
        val monday = LocalDate.now(ZoneId.of("Asia/Singapore")).let { d -> var m = d.plusDays(1); while (m.dayOfWeek != DayOfWeek.MONDAY) m = m.plusDays(1); m }
        val nurul = token(NURUL)
        val mine = get("/api/v1/scheduling/me?from=$monday&to=$monday", nurul)
        if (mine.jsonObject["shifts"]!!.jsonArray.isNotEmpty()) return monday.toString()
        val employeeId = get("/api/v1/me", nurul).jsonObject["employeeId"]!!.jsonPrimitive.content
        val kw = token(KAIWEN)
        val location = get("/api/v1/scheduling/scopes", kw).jsonObject["mine"]!!.jsonObject["locationId"]!!.jsonPrimitive.content
        val roster = post("/api/v1/scheduling/rosters", kw, buildJsonObject { put("weekStart", monday.toString()); put("locationId", location) })
        val rosterId = (roster.jsonObject["roster"]?.jsonObject ?: roster.jsonObject)["id"]!!.jsonPrimitive.content
        post("/api/v1/scheduling/rosters/$rosterId/shifts", kw, buildJsonObject {
            put("employeeId", employeeId); put("date", monday.toString()); put("kind", "shift")
            put("startTime", "09:00"); put("endTime", "17:00"); put("breakMinutes", 60)
        })
        post("/api/v1/scheduling/rosters/$rosterId/publish", kw, buildJsonObject { })
        return monday.toString()
    }

    /**
     * Nadia asks for a day of no-pay leave on [date] (for Kai Wen to decide); returns the task
     * title. No-pay leave is unlimited, so reruns against the same server never run out of balance.
     */
    fun requestLeaveAsNadia(date: LocalDate): String {
        val nadia = token(NADIA)
        val type = get("/api/v1/leave/types", nadia).items().first { it.jsonObject["code"]!!.jsonPrimitive.content == "no_pay" }
        val typeName = type.jsonObject["name"]!!.jsonPrimitive.content
        post("/api/v1/leave/requests", nadia, buildJsonObject {
            put("leaveTypeId", type.jsonObject["id"]!!.jsonPrimitive.content); put("startDate", date.toString()); put("endDate", date.toString())
        })
        val kw = token(KAIWEN)
        val day = crowtech.crowhr.core.Formats.date(date)
        return get("/api/v1/approvals/tasks", kw).items().map { it.jsonObject["title"]!!.jsonPrimitive.content }
            .first { it.startsWith(typeName) && it.contains(day) }
    }

    /** The app's default first day: next weekday that isn't a public holiday. */
    fun nextWorkingDay(): LocalDate = crowtech.crowhr.ui.screens.nextWorkingDay(LocalDate.now(ZoneId.of("Asia/Singapore")), holidays())

    private fun holidays(): Set<String> {
        val today = LocalDate.now(ZoneId.of("Asia/Singapore"))
        return listOf(today.year, today.year + 1).flatMap { y ->
            get("/api/v1/leave/holidays?year=$y", token(NADIA)).items().map { it.jsonObject["date"]!!.jsonPrimitive.content }
        }.toSet()
    }

    /** Withdraws Nadia's pending requests that start on [date] (keeps reruns independent). */
    fun withdrawPendingLeave(date: LocalDate) {
        val nadia = token(NADIA)
        get("/api/v1/leave/requests?limit=100", nadia).items().map { it.jsonObject }
            .filter { it["status"]!!.jsonPrimitive.content == "pending" && it["startDate"]!!.jsonPrimitive.content == date.toString() }
            .forEach { post("/api/v1/leave/requests/${it["id"]!!.jsonPrimitive.content}/withdraw", nadia) }
    }

    /** A working day (no weekend, no public holiday) at least [weeksAhead] weeks out that Nadia has no leave on. */
    fun freeWeekday(weeksAhead: Long, offsetDays: Long = 0): LocalDate {
        val holidays = holidays()
        val taken = get("/api/v1/leave/requests?limit=100", token(NADIA)).items()
            .filter { it.jsonObject["status"]!!.jsonPrimitive.content in setOf("pending", "approved") }
            .map { it.jsonObject["startDate"]!!.jsonPrimitive.content }.toSet()
        var d = LocalDate.now(ZoneId.of("Asia/Singapore")).plusWeeks(weeksAhead).plusDays(offsetDays).minusDays(1)
        do {
            d = crowtech.crowhr.ui.screens.nextWorkingDay(d, holidays)
        } while (d.toString() in taken)
        return d
    }
}

/** Plays the system browser: signs in as [email] and hands the callback to the app like Chrome would. */
class TestBrowser(private val email: String) : BrowserLauncher {
    val opened = CopyOnWriteArrayList<String>()
    override fun open(context: Context, url: String): Boolean {
        opened += url
        val app = context.applicationContext
        thread(name = "test-browser") {
            val redirect = TestServer.signInInBrowser(url, email)
            app.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse(redirect)).setPackage(app.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
        return true
    }
}

/** Camera stub: a generated receipt image instead of the camera app. */
class StubCamera : ReceiptCamera {
    var shots = 0
    @Composable
    override fun rememberCapture(onResult: (File?) -> Unit): () -> Unit {
        val context = LocalContext.current
        return {
            shots++
            val bitmap = Bitmap.createBitmap(600, 900, Bitmap.Config.ARGB_8888)
            Canvas(bitmap).apply {
                drawColor(Color.WHITE)
                val p = Paint().apply { color = Color.BLACK; textSize = 42f }
                drawText("KOPITIAM BUGIS", 40f, 100f, p)
                drawText("Kopi C x2   S$45.80", 40f, 200f, p)
            }
            val dir = File(context.cacheDir, "receipts").apply { mkdirs() }
            val file = File(dir, "stub-$shots.jpg")
            FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
            onResult(file)
        }
    }
}

/** Every connection the app's HTTP client makes (NetworkObserver). */
class NetworkRecorder {
    val hosts = CopyOnWriteArrayList<String>()
    val addresses = CopyOnWriteArrayList<String>()
    fun record(host: String, address: String) {
        hosts += host
        if (address.isNotEmpty()) addresses += address
    }
}
