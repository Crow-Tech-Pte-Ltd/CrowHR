package crowtech.crowhr.core

import crowtech.crowhr.Fixtures
import crowtech.crowhr.arr
import crowtech.crowhr.obj
import crowtech.crowhr.str
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The claim form's S$ preview: apps/mobile-fixtures/claim-money-cases.json (same rules as the server). */
class ClaimMoneyTest {
    private val fixture = Fixtures.load("claim-money-cases.json")

    private fun kotlinx.serialization.json.JsonObject.longOrNull(key: String): Long? =
        this[key]?.takeUnless { it is JsonNull }?.jsonPrimitive?.long

    @Test fun conversionsRoundHalfUpOncePerLine() {
        for (c in fixture.arr("convert").map { it.jsonObject }) {
            val got = ClaimMoney.toSgdCents(c.longOrNull("amountMinor")!!, c["exponent"]!!.jsonPrimitive.int, c.longOrNull("rateMicros")!!)
            assertEquals("${c.str("currency")} ${c.longOrNull("amountMinor")} @ ${c.longOrNull("rateMicros")}", c.longOrNull("sgdCents"), got)
        }
    }

    @Test fun rates() {
        for (c in fixture.arr("rates").map { it.jsonObject }) {
            assertEquals("rate \"${c.str("text")}\"", c.longOrNull("rateMicros"), ClaimMoney.parseRateMicros(c.str("text")!!))
        }
    }

    @Test fun amountsInTheCurrencysMinorUnits() {
        for (c in fixture.arr("amounts").map { it.jsonObject }) {
            assertEquals("amount \"${c.str("text")}\" exp ${c["exponent"]}", c.longOrNull("amountMinor"), ClaimMoney.parseMinor(c.str("text")!!, c["exponent"]!!.jsonPrimitive.int))
        }
    }

    @Test fun previews() {
        for (c in fixture.arr("previews").map { it.jsonObject }) {
            assertEquals("preview $c", c.longOrNull("sgdCents"), ClaimMoney.previewSgd(c.str("currency")!!, c.longOrNull("amountMinor"), c.str("rate")))
        }
    }

    @Test fun formats() {
        for (c in fixture.arr("formats").map { it.jsonObject }) {
            assertEquals(c.str("text"), ClaimMoney.formatMinorAmount(c.longOrNull("amountMinor")!!, c["exponent"]!!.jsonPrimitive.int))
        }
        assertEquals("1234.50", ClaimMoney.editableAmount(123_450, 2))
        assertEquals("MYR 125.50", ClaimMoney.formatForeign("MYR", 12_550))
        assertEquals("JPY 5,000", ClaimMoney.formatForeign("JPY", 5000))
    }

    @Test fun exponents() {
        fixture.obj("exponents")!!.forEach { (code, exp) -> assertEquals(code, exp.jsonPrimitive.int, ClaimMoney.exponentOf(code)) }
        // A code the web form doesn't offer still gets its ISO 4217 digits (a draft made elsewhere).
        assertEquals(3, ClaimMoney.exponentOf("BHD"))
        assertEquals(2, ClaimMoney.exponentOf("NOPE"))
    }

    @Test fun exchangeRateWarningPercentages() {
        for (c in fixture.arr("basisPoints").map { it.jsonObject }) {
            assertEquals(c.str("text"), ClaimMoney.formatBasisPoints(c.longOrNull("deviationBasisPoints")!!))
        }
    }

    @Test fun overflowGivesNoAmountInsteadOfAWrongOne() {
        assertNull(ClaimMoney.toSgdCents(9_007_199_254_740_991L, 0, 999_000_000_000L))
        assertNull(ClaimMoney.parseMinor("999999999999999", 2))
        assertNull(ClaimMoney.toSgdCents(0, 2, 1))
        assertNull(ClaimMoney.toSgdCents(10, 5, 1))
    }
}
