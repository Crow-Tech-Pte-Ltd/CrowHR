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

    @Test fun nricMasking() {
        for (c in cases["nric"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(c.str("masked"), Formats.maskNric(c.str("value")!!))
        }
    }
}
