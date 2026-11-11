package crowtech.crowhr.core

import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset

/**
 * Singapore display conventions, identical to the web's packages/ui/src/lib/format.ts and
 * checked against apps/mobile-fixtures/format-cases.json. Money is integer cents (Long) and
 * never goes through floating point.
 */
object Formats {
    val SINGAPORE: ZoneId = ZoneId.of("Asia/Singapore")
    private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

    /** 123456 → "S$1,234.56"; -500 → "-S$5.00". */
    fun money(cents: Long, symbol: Boolean = true): String {
        val negative = cents < 0
        // Long.MIN_VALUE has no positive counterpart; amounts that large are never valid money.
        require(cents != Long.MIN_VALUE) { "Money out of range" }
        val abs = if (negative) -cents else cents
        val dollars = abs / 100
        val rem = abs % 100
        val body = "${groupThousands(dollars.toString())}.${rem.toString().padStart(2, '0')}"
        val withSymbol = if (symbol) "S$$body" else body
        return if (negative) "-$withSymbol" else withSymbol
    }

    /**
     * How TalkBack says an amount, like iOS: 123456 → "1,234 Singapore dollars 56 cents",
     * -500 → "minus 5 Singapore dollars". "S$" alone is read inconsistently by screen readers.
     */
    fun moneySpoken(cents: Long): String {
        require(cents != Long.MIN_VALUE) { "Money out of range" }
        val abs = if (cents < 0) -cents else cents
        val dollars = abs / 100
        val rem = abs % 100
        val text = buildString {
            append("${groupThousands(dollars.toString())} Singapore ${if (dollars == 1L) "dollar" else "dollars"}")
            if (rem > 0) append(" $rem ${if (rem == 1L) "cent" else "cents"}")
        }
        return if (cents < 0) "minus $text" else text
    }

    /** Hours without a pointless ".0": 4.0 → "4", 4.5 → "4.5", 1.25 → "1.25". */
    fun hours(value: Double): String =
        java.math.BigDecimal.valueOf(value).setScale(2, java.math.RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()

    private fun groupThousands(digits: String): String {
        val out = StringBuilder()
        digits.forEachIndexed { i, c ->
            if (i > 0 && (digits.length - i) % 3 == 0) out.append(',')
            out.append(c)
        }
        return out.toString()
    }

    sealed interface MoneyParse {
        data class Ok(val cents: Long) : MoneyParse
        data class Error(val reason: String) : MoneyParse
    }

    /** Accepts "1234", "1,234.5", "S$1,234.56", "$12"; refuses more than 2 decimals. */
    fun parseMoney(input: String): MoneyParse {
        val cleaned = input.trim()
            .replace(Regex("^(-?)\\s*(S\\$|\\$)\\s*", RegexOption.IGNORE_CASE), "$1")
            .replace(Regex("[,\\s]"), "")
        if (cleaned.isEmpty() || cleaned == "-") return MoneyParse.Error("empty")
        val m = Regex("^(-?)(\\d+)?(?:\\.(\\d*))?$").matchEntire(cleaned)
            ?: return MoneyParse.Error("invalid")
        val sign = m.groupValues[1]
        val whole = m.groups[2]?.value
        val fraction = m.groups[3]?.value ?: ""
        if (whole == null && fraction.isEmpty()) return MoneyParse.Error("invalid")
        if (fraction.length > 2) return MoneyParse.Error("too_many_decimals")
        val wholeValue = (whole ?: "0").toBigInteger()
        val cents = wholeValue * 100.toBigInteger() + fraction.padEnd(2, '0').toBigInteger()
        if (cents > 9_007_199_254_740_991L.toBigInteger()) return MoneyParse.Error("too_large")
        val value = cents.toLong()
        return MoneyParse.Ok(if (sign == "-") -value else value)
    }

    fun moneyParseMessage(reason: String): String = when (reason) {
        "empty" -> "Enter an amount, like 1,250.00."
        "too_many_decimals" -> "Use at most 2 decimal places (cents)."
        "too_large" -> "That amount is too large."
        else -> "Use digits with an optional decimal point, like 1,250.00."
    }

    /** "2026-10-31" (or a longer ISO string starting with a date) → "31 Oct 2026". */
    fun date(iso: String): String {
        val m = Regex("^(\\d{4})-(\\d{2})-(\\d{2})").find(iso)
            ?: throw IllegalArgumentException("Expected YYYY-MM-DD, got \"$iso\".")
        val (y, mo, d) = m.destructured
        return "${d.toInt()} ${MONTHS[mo.toInt() - 1]} $y"
    }

    fun date(value: LocalDate): String = "${value.dayOfMonth} ${MONTHS[value.monthValue - 1]} ${value.year}"

    /** An instant shown in Singapore time, 24-hour: "08:58". */
    fun time(instant: Instant): String {
        val t = instant.atZone(SINGAPORE)
        return "%02d:%02d".format(t.hour, t.minute)
    }

    /** "2 Nov 2026, 08:58" in Singapore time. */
    fun dateTime(instant: Instant): String {
        val t = instant.atZone(SINGAPORE)
        return "${date(t.toLocalDate())}, ${time(instant)}"
    }

    fun parseInstant(value: String): Instant? = runCatching { OffsetDateTime.parse(value).toInstant() }
        .recoverCatching { Instant.parse(value) }
        .getOrNull()

    fun todayInSingapore(now: Instant): LocalDate = now.atZone(SINGAPORE).toLocalDate()

    /** NRIC/FIN: "S1234567D" → "S****567D"; anything else is fully masked. */
    fun maskNric(value: String): String {
        val v = value.trim().uppercase()
        if (!Regex("^[STFGM]\\d{7}[A-Z]$").matches(v)) return "*********"
        return "${v[0]}****${v.substring(5)}"
    }

    /** "11:30" style hours from minutes: 450 → "7h 30m". */
    fun duration(minutes: Int): String {
        val h = minutes / 60
        val m = minutes % 60
        return if (m == 0) "${h}h" else "${h}h ${m}m"
    }

    val UTC: ZoneOffset = ZoneOffset.UTC
}
