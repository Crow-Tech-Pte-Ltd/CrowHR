package crowtech.crowhr.core

import crowtech.crowhr.Fixtures
import crowtech.crowhr.obj
import crowtech.crowhr.str
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

/** apps/mobile-fixtures/format-cases.json: the same results as the web formatters. */
class FormatsTest {
    private val cases = Fixtures.load("format-cases.json")

    @Test fun money() {
        for (c in cases["money"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(c.str("text"), Formats.money(c["cents"]!!.jsonPrimitive.long))
        }
    }

    @Test fun moneyParse() {
        for (c in cases["moneyParse"]!!.jsonArray.map { it.jsonObject }) {
            val input = c.str("input")!!
            val expected = c["cents"]?.jsonPrimitive?.long?.let { Formats.MoneyParse.Ok(it) }
                ?: Formats.MoneyParse.Error(c.str("error")!!)
            assertEquals("parse \"$input\"", expected, Formats.parseMoney(input))
        }
    }

    @Test fun dates() {
        for (c in cases["dates"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(c.str("text"), Formats.date(c.str("iso")!!))
        }
    }

    @Test fun singaporeTimes() {
        for (c in cases.obj("dateTimes")!!["cases"]!!.jsonArray.map { it.jsonObject }) {
            val instant = Instant.parse(c.str("instant"))
            assertEquals(c.str("time"), Formats.time(instant))
            assertEquals(c.str("dateTime"), Formats.dateTime(instant))
        }
    }

    /** Crow HR shows Singapore time whatever the phone's time zone is (like the web). */
    @Test fun singaporeTimesUnderOtherDeviceTimeZones() {
        val original = java.util.TimeZone.getDefault()
        try {
            for (zone in listOf("America/New_York", "Europe/London", "Pacific/Kiritimati", "UTC")) {
                java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone(zone))
                for (c in cases.obj("dateTimes")!!["cases"]!!.jsonArray.map { it.jsonObject }) {
                    val instant = Instant.parse(c.str("instant"))
                    assertEquals("$zone time", c.str("time"), Formats.time(instant))
                    assertEquals("$zone dateTime", c.str("dateTime"), Formats.dateTime(instant))
                }
                // 16:30Z on 1 Nov is already 2 Nov in Singapore, whatever the device says.
                assertEquals(java.time.LocalDate.parse("2026-11-02"), Formats.todayInSingapore(Instant.parse("2026-11-01T16:30:00Z")))
                assertEquals("7 Nov 2026, 03:24", Formats.dateTime(Formats.parseInstant("2026-11-06T19:24:00.000Z")!!))
            }
        } finally {
            java.util.TimeZone.setDefault(original)
        }
    }

    /** Guard: screens format through [Formats]; nothing reads the device time zone for display. */
    @Test fun noScreenUsesTheDeviceTimeZone() {
        val forbidden = listOf("LocalDate.now()", "LocalTime.now()", "LocalDateTime.now()", "SimpleDateFormat", "DateFormat.get", "java.util.Date(", "TimeZone.getDefault")
        val offenders = java.io.File("src/main/java").walk().filter { it.extension == "kt" }.flatMap { f ->
            f.readLines().mapIndexedNotNull { i, line ->
                val code = line.substringBefore("//")
                when {
                    forbidden.any { it in code } -> "${f.name}:${i + 1}: $line"
                    // The only allowed use: the UTC offset stored with a punch (never shown, never sent).
                    "ZoneId.systemDefault()" in code && "utcOffsetMinutes" !in code -> "${f.name}:${i + 1}: $line"
                    else -> null
                }
            }
        }.toList()
        assertEquals(emptyList<String>(), offenders)
    }

    @Test fun nricMasking() {
        for (c in cases["nric"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(c.str("masked"), Formats.maskNric(c.str("value")!!))
        }
    }
}
