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

    /** Legal name, UEN, CSN and address: payroll and the logo need them. */
    fun ensureCompanyProfile() {
        val reply = call("PUT", "/api/v1/organisation/profile", token(OWNER), buildJsonObject {
            put("legalName", "Kampong Kopi Pte. Ltd."); put("uen", "202600001K"); put("csn", "202600001KPTE01")
            put("addressBlock", "1"); put("addressStreet", "Kampong Bahru Road"); put("postalCode", "169341")
        })
        check(reply.status in 200..299) { "company profile → ${reply.status} ${reply.body}" }
    }

    /** The organisation has a logo (meta then links it publicly; same host as the server). */
    fun ensureLogo() {
        val meta = call("GET", "/api/v1/meta?org=$ORG", null).body.jsonObject
        val org = meta["organisations"]!!.jsonArray.first().jsonObject
        if (org["logoUrl"] !is JsonNull) return
        ensureCompanyProfile()
        val bitmap = Bitmap.createBitmap(96, 96, Bitmap.Config.ARGB_8888)
        Canvas(bitmap).apply {
            drawColor(Color.rgb(0xFE, 0xD5, 0x6C))
            drawRect(30f, 30f, 66f, 66f, Paint().apply { color = Color.rgb(0x0A, 0x0A, 0x0A) })
        }
        val png = java.io.ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        val reply = call("PUT", "/api/v1/organisation/profile/logo", token(OWNER), buildJsonObject {
            put("contentType", "image/png"); put("dataBase64", android.util.Base64.encodeToString(png, android.util.Base64.NO_WRAP))
        })
        check(reply.status in 200..299) { "logo upload → ${reply.status} ${reply.body}" }
    }

    /** Nadia gets a released payslip: last month's run, computed, approved by the owner, released. */
    fun ensureReleasedPayslip(): JsonObject {
        get("/api/v1/payslips", token(NADIA)).items().firstOrNull()?.let { return it.jsonObject }
        val owner = token(OWNER)
        val payroll = token(PAYROLL)
        ensureCompanyProfile()
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

    const val MARCUS = "marcus@kampongkopi.example"

    /**
     * Nadia's baby, under two, so unpaid infant care leave (which must name a child) applies.
     * Added once, through the same API as the web's Leave → Children: (id, name).
     */
    fun ensureChildOfNadia(): Pair<String, String> = ensureChild(NADIA, "Iman Rahman")

    fun ensureChild(email: String, name: String): Pair<String, String> {
        val nadia = token(email)
        get("/api/v1/leave/children", nadia).items().map { it.jsonObject }.firstOrNull { it["name"]!!.jsonPrimitive.content == name }
            ?.let { return it["id"]!!.jsonPrimitive.content to name }
        val born = LocalDate.now(ZoneId.of("Asia/Singapore")).minusMonths(10)
        val child = post("/api/v1/leave/children", nadia, buildJsonObject {
            put("name", name); put("birthDate", born.toString()); put("isCitizen", true); put("birthOrder", 1)
        }).jsonObject
        return child["id"]!!.jsonPrimitive.content to name
    }

    /** Nadia asks for a day of no-pay leave on [date] and Kai Wen approves it: Nadia gets an unread notification. */
    fun approvedLeaveForNadia(date: LocalDate): String {
        val title = requestLeaveAsNadia(date)
        val kw = token(KAIWEN)
        val task = get("/api/v1/approvals/tasks", kw).items().map { it.jsonObject }.first { it["title"]!!.jsonPrimitive.content == title }
        post("/api/v1/approvals/tasks/${task["taskId"]!!.jsonPrimitive.content}/decision", kw, buildJsonObject { put("decision", "approve") })
        return title
    }

    /** Cancels [email]'s pending swap and pickup requests (keeps reruns independent). */
    fun cancelPendingSwaps(email: String) {
        val t = token(email)
        get("/api/v1/scheduling/swaps", t).items().map { it.jsonObject }
            .filter { it["direction"]!!.jsonPrimitive.content == "outgoing" && it["status"]!!.jsonPrimitive.content in setOf("pending_peer", "pending_approval") }
            .forEach { post("/api/v1/scheduling/swaps/${it["id"]!!.jsonPrimitive.content}/cancel", t) }
    }

    /** Nurul's published shift next Monday (see [ensurePublishedShift]): its id. */
    fun nurulsShiftId(monday: String): String =
        get("/api/v1/scheduling/me?from=$monday&to=$monday", token(NURUL)).jsonObject["shifts"]!!.jsonArray.first().jsonObject["id"]!!.jsonPrimitive.content

    /** An open (unassigned) published shift next Tuesday on the same roster as Nurul's: its id. */
    fun ensureOpenShift(monday: String): String {
        val tuesday = LocalDate.parse(monday).plusDays(1).toString()
        val nurul = token(NURUL)
        get("/api/v1/scheduling/me?from=$tuesday&to=$tuesday", nurul).jsonObject["openShifts"]!!.jsonArray
            .firstOrNull()?.let { return it.jsonObject["id"]!!.jsonPrimitive.content }
        val kw = token(KAIWEN)
        val location = get("/api/v1/scheduling/scopes", kw).jsonObject["mine"]!!.jsonObject["locationId"]!!.jsonPrimitive.content
        val roster = post("/api/v1/scheduling/rosters", kw, buildJsonObject { put("weekStart", monday); put("locationId", location) })
        val rosterId = (roster.jsonObject["roster"]?.jsonObject ?: roster.jsonObject)["id"]!!.jsonPrimitive.content
        post("/api/v1/scheduling/rosters/$rosterId/shifts", kw, buildJsonObject {
            put("employeeId", JsonNull); put("date", tuesday); put("kind", "shift")
            put("startTime", "12:00"); put("endTime", "20:00"); put("breakMinutes", 30)
        })
        post("/api/v1/scheduling/rosters/$rosterId/publish", kw, buildJsonObject { })
        return get("/api/v1/scheduling/me?from=$tuesday&to=$tuesday", nurul).jsonObject["openShifts"]!!.jsonArray.first().jsonObject["id"]!!.jsonPrimitive.content
    }

    /** Nurul offers [shiftId] to Marcus (give-away) through the API: the offer's id. */
    fun offerToMarcus(shiftId: String): String {
        val marcusId = get("/api/v1/me", token(MARCUS)).jsonObject["employeeId"]!!.jsonPrimitive.content
        return post("/api/v1/scheduling/swaps", token(NURUL), buildJsonObject {
            put("kind", "giveaway"); put("shiftId", shiftId); put("peerEmployeeId", marcusId); put("note", "Family dinner, sorry")
        }).jsonObject["id"]!!.jsonPrimitive.content
    }

    /** Ahmad's claims still waiting (from earlier runs) are withdrawn, drafts deleted. */
    fun clearClaimsOfAhmad() {
        val t = token(AHMAD)
        get("/api/v1/claims?mine=true&pageSize=100", t).items().map { it.jsonObject }.forEach {
            val id = it["id"]!!.jsonPrimitive.content
            when (it["status"]!!.jsonPrimitive.content) {
                "draft" -> call("DELETE", "/api/v1/claims/$id", t)
                "submitted" -> call("POST", "/api/v1/claims/$id/withdraw", t)
            }
        }
    }

    // --- Demo companies (servers started with DEMO_COMPANIES=1) ---

    fun demoCompaniesOn(): Boolean = call("GET", "/api/v1/demo-companies/config", null).status == 200

    /**
     * A new private copy of Kopi Kaki, as the try page starts one. With no ready copies
     * (DEMO_COMPANY_POOL_SIZE=0) the server seeds it there and then: about 20 s on a workstation.
     */
    fun startDemoCompany(): JsonObject {
        val slow = http.newBuilder().readTimeout(java.time.Duration.ofMinutes(3)).build()
        val request = Request.Builder().url("$base/api/v1/demo-companies").post("{}".toRequestBody(json)).build()
        slow.newCall(request).execute().use { r ->
            val text = r.body?.string().orEmpty()
            check(r.code == 201) { "demo company → ${r.code} $text" }
            return Json.parseToJsonElement(text).jsonObject
        }
    }

    /**
     * What the system browser does on a demo company's sign-in page: follow /native/authorize to
     * the page, pick the person ([personaKey], such as "employee"), and come back to the app.
     */
    fun signInAsPersona(authorizeUrl: String, org: String, personaKey: String): String {
        val location = http.newCall(Request.Builder().url(authorizeUrl).build()).execute().use { r ->
            check(r.code == 302) { "authorize → ${r.code}" }
            r.header("Location")!!
        }
        check(location.contains("/sign-in/$org")) { "the sign-in page is for $org: $location" }
        val requestId = location.substringAfter("native=")
        val personas = call("GET", "/api/v1/auth/demo/personas?org=$org", null)
        check(personas.status == 200) { "personas → ${personas.status} ${personas.body}" }
        val person = personas.body.items().map { it.jsonObject }.first { it["persona"]?.jsonObject?.get("key")?.jsonPrimitive?.content == personaKey }
        val reply = call("POST", "/api/v1/auth/demo/sign-in", null, buildJsonObject {
            put("membershipId", person["membershipId"]!!.jsonPrimitive.content); put("org", org); put("native", requestId)
        })
        check(reply.status == 200) { "persona sign-in → ${reply.status} ${reply.body}" }
        return reply.body.jsonObject["redirectTo"]!!.jsonPrimitive.content
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

/** Plays the system browser on a demo company's sign-in page: picks [personaKey], no password. */
class PersonaBrowser(private val org: String, private val personaKey: String) : BrowserLauncher {
    val opened = CopyOnWriteArrayList<String>()
    override fun open(context: Context, url: String): Boolean {
        opened += url
        val app = context.applicationContext
        thread(name = "persona-browser") {
            val redirect = TestServer.signInAsPersona(url, org, personaKey)
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
    override fun rememberCapture(onError: (String) -> Unit, onResult: (File?) -> Unit): () -> Unit {
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
