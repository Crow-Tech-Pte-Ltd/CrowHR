package crowtech.crowhr.core

import java.math.BigInteger

/**
 * The claim form's money preview, the same rules as the server (packages/core/src/claims/money.ts)
 * and the web form (apps/web/src/routes/_app/claims/-lib/money.ts), checked against
 * apps/mobile-fixtures/claim-money-cases.json. The server recomputes every line; this only makes
 * sure the S$ amount shown while typing is the one that will be stored. Integers only: amounts in
 * the currency's minor units, rates in millionths, one half-up rounding per line.
 */
object ClaimMoney {
    data class Currency(val code: String, val exponent: Int, val label: String)

    /** The currencies the web form offers, in its order (ISO 4217 exponents). */
    val CURRENCIES = listOf(
        Currency("SGD", 2, "Singapore dollar"),
        Currency("MYR", 2, "Malaysian ringgit"),
        Currency("IDR", 2, "Indonesian rupiah"),
        Currency("THB", 2, "Thai baht"),
        Currency("PHP", 2, "Philippine peso"),
        Currency("VND", 0, "Vietnamese dong"),
        Currency("USD", 2, "US dollar"),
        Currency("EUR", 2, "Euro"),
        Currency("GBP", 2, "Pound sterling"),
        Currency("AUD", 2, "Australian dollar"),
        Currency("CNY", 2, "Chinese yuan"),
        Currency("HKD", 2, "Hong Kong dollar"),
        Currency("TWD", 2, "New Taiwan dollar"),
        Currency("JPY", 0, "Japanese yen"),
        Currency("KRW", 0, "South Korean won"),
        Currency("INR", 2, "Indian rupee"),
        Currency("KWD", 3, "Kuwaiti dinar"),
    )

    /**
     * Minor-unit digits: the list above, else the JDK's ISO 4217 table (a draft made elsewhere may
     * use any code the server accepts), else 2.
     */
    fun exponentOf(code: String): Int =
        CURRENCIES.firstOrNull { it.code == code }?.exponent
            ?: runCatching { java.util.Currency.getInstance(code).defaultFractionDigits }.getOrNull()?.takeIf { it in 0..4 }
            ?: 2

    private const val MAX_SAFE = 9_007_199_254_740_991L

    /** "125.50", 2 → 12550; "5,000", 0 → 5000. Null unless a positive amount with at most [exponent] decimals. */
    fun parseMinor(text: String, exponent: Int): Long? {
        val t = text.trim().replace(",", "")
        val pattern = if (exponent == 0) Regex("^(\\d{1,15})$") else Regex("^(\\d{1,15})(?:\\.(\\d{1,$exponent}))?$")
        val m = pattern.matchEntire(t) ?: return null
        val whole = m.groupValues[1].toBigInteger()
        // Exponent 0 has no fraction group at all.
        val fraction = m.groupValues.getOrElse(2) { "" }.padEnd(exponent, '0').ifEmpty { "0" }.toBigInteger()
        val minor = whole * BigInteger.TEN.pow(exponent) + fraction
        return minor.takeIf { it.signum() > 0 && it <= MAX_SAFE.toBigInteger() }?.toLong()
    }

    /** 12550, 2 → "125.50"; 5000, 0 → "5,000" (as the web shows it). */
    fun formatMinorAmount(minor: Long, exponent: Int): String {
        val div = BigInteger.TEN.pow(exponent)
        val (whole, rest) = minor.toBigInteger().divideAndRemainder(div)
        val grouped = whole.toString().reversed().chunked(3).joinToString(",").reversed()
        return if (exponent > 0) "$grouped.${rest.toString().padStart(exponent, '0')}" else grouped
    }

    /** The amount as typed back into the form for editing: no thousands separators. */
    fun editableAmount(minor: Long, exponent: Int): String = formatMinorAmount(minor, exponent).replace(",", "")

    private val RATE = Regex("^(\\d{1,9})(?:\\.(\\d{1,6}))?$")

    /** "0.301234" → 301234 (millionths of S$ per 1 unit); null unless positive with at most 6 decimals. */
    fun parseRateMicros(text: String): Long? {
        val m = RATE.matchEntire(text.trim()) ?: return null
        val micros = m.groupValues[1].toLong() * 1_000_000 + (m.groups[2]?.value ?: "").padEnd(6, '0').toLong()
        return micros.takeIf { it > 0 }
    }

    /** roundHalfUp(amountMinor × rateMicros × 100 / (10^exponent × 10^6)), exactly. */
    fun toSgdCents(amountMinor: Long, exponent: Int, rateMicros: Long): Long? {
        if (amountMinor <= 0 || rateMicros <= 0 || exponent !in 0..4) return null
        val n = amountMinor.toBigInteger() * rateMicros.toBigInteger() * 100.toBigInteger()
        val d = BigInteger.TEN.pow(exponent) * 1_000_000.toBigInteger()
        val cents = (2.toBigInteger() * n + d) / (2.toBigInteger() * d)
        return cents.takeIf { it <= MAX_SAFE.toBigInteger() }?.toLong()
    }

    /** S$ cents for a line being typed, or null while it is incomplete. */
    fun previewSgd(currency: String, amountMinor: Long?, rate: String?): Long? {
        if (amountMinor == null) return null
        if (currency == "SGD") return amountMinor
        val micros = rate?.let(::parseRateMicros) ?: return null
        return toSgdCents(amountMinor, exponentOf(currency), micros)
    }

    /** 3334 → "33.34%": basis points as a percentage, sign dropped (the web's formatBasisPoints). */
    fun formatBasisPoints(bp: Long): String {
        val a = if (bp < 0) -bp else bp
        return "${a / 100}.${(a % 100).toString().padStart(2, '0')}%"
    }

    /** "MYR 125.50", "JPY 5,000". */
    fun formatForeign(currency: String, amountMinor: Long): String = "$currency ${formatMinorAmount(amountMinor, exponentOf(currency))}"
}
