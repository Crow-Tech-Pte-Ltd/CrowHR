import Foundation

/// Claim money for the claim form, mirroring the web form's helpers
/// (`apps/web/src/routes/_app/claims/-lib/money.ts`) and the server's rule
/// (`packages/core/src/claims/money.ts`), so the SGD preview never disagrees with what is stored.
/// Integers only: amounts in the currency's minor units, rates in millionths, one half-up rounding
/// per line. Cases shared with Android: apps/mobile-fixtures/claim-money-cases.json.
enum ClaimMoney {
    struct Currency: Equatable, Sendable, Identifiable {
        var id: String { code }
        let code: String
        /// ISO 4217 minor-unit exponent (JPY 0, SGD 2, KWD 3).
        let exponent: Int
        let label: String
    }

    /// The currencies the web form offers, in its order.
    static let currencies: [Currency] = [
        .init(code: "SGD", exponent: 2, label: "Singapore dollar"),
        .init(code: "MYR", exponent: 2, label: "Malaysian ringgit"),
        .init(code: "IDR", exponent: 2, label: "Indonesian rupiah"),
        .init(code: "THB", exponent: 2, label: "Thai baht"),
        .init(code: "PHP", exponent: 2, label: "Philippine peso"),
        .init(code: "VND", exponent: 0, label: "Vietnamese dong"),
        .init(code: "USD", exponent: 2, label: "US dollar"),
        .init(code: "EUR", exponent: 2, label: "Euro"),
        .init(code: "GBP", exponent: 2, label: "Pound sterling"),
        .init(code: "AUD", exponent: 2, label: "Australian dollar"),
        .init(code: "CNY", exponent: 2, label: "Chinese yuan"),
        .init(code: "HKD", exponent: 2, label: "Hong Kong dollar"),
        .init(code: "TWD", exponent: 2, label: "New Taiwan dollar"),
        .init(code: "JPY", exponent: 0, label: "Japanese yen"),
        .init(code: "KRW", exponent: 0, label: "South Korean won"),
        .init(code: "INR", exponent: 2, label: "Indian rupee"),
        .init(code: "KWD", exponent: 3, label: "Kuwaiti dinar"),
    ]

    static func exponent(of code: String) -> Int {
        currencies.first { $0.code == code }?.exponent ?? 2
    }

    /// "125.50" → 12550 at exponent 2; "5,000" → 5000 at exponent 0. Nil unless a positive amount
    /// with at most `exponent` decimals and up to 15 whole digits.
    static func parseMinor(_ text: String, exponent: Int) -> Int? {
        let t = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: "")
        let parts = t.split(separator: ".", omittingEmptySubsequences: false)
        guard let whole = parts.first, (1...15).contains(whole.count), whole.allSatisfy(\.isASCIIDigit) else { return nil }
        var fraction = ""
        if parts.count == 2 {
            guard exponent > 0, (1...exponent).contains(parts[1].count), parts[1].allSatisfy(\.isASCIIDigit) else { return nil }
            fraction = String(parts[1])
        } else if parts.count > 2 {
            return nil
        }
        let padded = fraction.padding(toLength: exponent, withPad: "0", startingAt: 0)
        guard let w = Int(whole), let f = Int(padded.isEmpty ? "0" : padded) else { return nil }
        let (scaled, o1) = w.multipliedReportingOverflow(by: pow10(exponent))
        let (minor, o2) = scaled.addingReportingOverflow(f)
        guard !o1, !o2, minor > 0, minor <= maxSafeInteger else { return nil }
        return minor
    }

    /// 12550, 2 → "125.50"; 5000, 0 → "5,000".
    static func formatMinor(_ minor: Int, exponent: Int) -> String {
        let div = pow10(exponent)
        let whole = groupThousands(String(minor / div))
        guard exponent > 0 else { return whole }
        let rest = String(minor % div)
        return whole + "." + String(repeating: "0", count: max(0, exponent - rest.count)) + rest
    }

    /// "MYR 125.50", as the web shows a foreign amount.
    static func foreignAmount(currency: String, amountMinor: Int) -> String {
        "\(currency) \(formatMinor(amountMinor, exponent: exponent(of: currency)))"
    }

    /// "0.301234" → 301234; nil unless a positive decimal with at most 6 places.
    static func parseRateMicros(_ text: String) -> Int? {
        let parts = text.trimmingCharacters(in: .whitespaces).split(separator: ".", omittingEmptySubsequences: false)
        guard let whole = parts.first, (1...9).contains(whole.count), whole.allSatisfy(\.isASCIIDigit), parts.count <= 2 else { return nil }
        var fraction = ""
        if parts.count == 2 {
            guard (1...6).contains(parts[1].count), parts[1].allSatisfy(\.isASCIIDigit) else { return nil }
            fraction = String(parts[1])
        }
        guard let w = Int(whole), let f = Int(fraction.padding(toLength: 6, withPad: "0", startingAt: 0)) else { return nil }
        let micros = w * 1_000_000 + f
        return micros > 0 ? micros : nil
    }

    /// roundHalfUp(amountMinor × rateMicros × 100 / (10^exponent × 10^6)), exact in 128 bits.
    /// Nil if the result is not a safe integer (the server refuses it too).
    static func toSgdCents(amountMinor: Int, exponent: Int, rateMicros: Int) -> Int? {
        guard amountMinor > 0, rateMicros > 0, (0...4).contains(exponent) else { return nil }
        let n = UInt128(amountMinor) * UInt128(rateMicros) * 100
        let d = UInt128(pow10(exponent)) * 1_000_000
        let cents = (2 * n + d) / (2 * d)
        guard cents <= UInt128(maxSafeInteger) else { return nil }
        return Int(cents)
    }

    /// The SGD cents of a line being typed, or nil while it is incomplete.
    static func previewSgd(currency: String, amountMinor: Int?, rate: String?) -> Int? {
        guard let amountMinor else { return nil }
        if currency == "SGD" { return amountMinor }
        guard let rate, let micros = parseRateMicros(rate) else { return nil }
        return toSgdCents(amountMinor: amountMinor, exponent: exponent(of: currency), rateMicros: micros)
    }

    /// JavaScript's `Number.MAX_SAFE_INTEGER`: money must stay exact on the server.
    static let maxSafeInteger = 9_007_199_254_740_991

    private static func pow10(_ e: Int) -> Int { (0..<e).reduce(1) { r, _ in r * 10 } }

    private static func groupThousands(_ digits: String) -> String {
        var out = ""
        for (i, ch) in digits.reversed().enumerated() {
            if i > 0 && i % 3 == 0 { out.append(",") }
            out.append(ch)
        }
        return String(out.reversed())
    }
}

private extension Character {
    var isASCIIDigit: Bool { isASCII && isNumber }
}
