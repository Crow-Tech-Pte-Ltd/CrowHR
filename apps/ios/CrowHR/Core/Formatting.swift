import Foundation

/// Singapore conventions from AGENTS.md: `S$1,234.56`, `31 Oct 2026`, NRIC/FIN masked
/// (`S****567D`). Money is integer cents end to end; formatting never goes through Double.
enum Fmt {
    static let singapore = TimeZone(identifier: "Asia/Singapore")!

    static func money(cents: Int) -> String {
        let negative = cents < 0
        let magnitude = cents.magnitude
        let dollars = magnitude / 100
        let rest = magnitude % 100
        let s = "S$" + groupThousands(String(dollars)) + "." + (rest < 10 ? "0" : "") + String(rest)
        return negative ? "-" + s : s
    }

    /// Spoken form for VoiceOver: "1,234 dollars 56 cents".
    static func moneySpoken(cents: Int) -> String {
        let m = cents.magnitude
        let d = m / 100, c = m % 100
        var s = "\(groupThousands(String(d))) Singapore dollars"
        if c > 0 { s += " \(c) cents" }
        return (cents < 0 ? "minus " : "") + s
    }

    private static func groupThousands(_ digits: String) -> String {
        var out = ""
        for (i, ch) in digits.reversed().enumerated() {
            if i > 0 && i % 3 == 0 { out.append(",") }
            out.append(ch)
        }
        return String(out.reversed())
    }

    enum MoneyParseError: String, Error, Equatable, Sendable {
        case empty
        case tooManyDecimals = "too_many_decimals"
        case invalid
    }

    /// Parses a typed dollar amount ("1234", "1,234.5", "S$1,234.56", "$12") into cents without
    /// floating point (apps/mobile-fixtures/format-cases.json `moneyParse`).
    static func parseMoney(_ input: String) -> Result<Int, MoneyParseError> {
        var s = input.trimmingCharacters(in: .whitespaces)
        if s.isEmpty { return .failure(.empty) }
        if s.uppercased().hasPrefix("S$") { s.removeFirst(2) } else if s.hasPrefix("$") { s.removeFirst() }
        s = s.replacingOccurrences(of: ",", with: "")
        let parts = s.split(separator: ".", omittingEmptySubsequences: false)
        guard (1...2).contains(parts.count), let whole = parts.first, !whole.isEmpty, whole.count <= 14,
              whole.allSatisfy({ $0.isASCII && $0.isNumber })
        else { return .failure(.invalid) }
        var cents = Int(whole)! * 100
        if parts.count == 2 {
            let frac = parts[1]
            guard !frac.isEmpty, frac.allSatisfy({ $0.isASCII && $0.isNumber }) else { return .failure(.invalid) }
            guard frac.count <= 2 else { return .failure(.tooManyDecimals) }
            cents += Int(frac.count == 1 ? frac + "0" : String(frac))!
        }
        return .success(cents)
    }

    /// A positive claim amount in cents, or nil.
    static func parseCents(_ input: String) -> Int? {
        guard case .success(let c) = parseMoney(input), c > 0 else { return nil }
        return c
    }

    /// The Gregorian calendar in Singapore time: the server's days and years, whatever the
    /// phone's own time zone and calendar (Buddhist, Japanese) are.
    static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = singapore
        c.locale = Locale(identifier: "en_SG")
        return c
    }()

    /// The Singapore year of an instant (`Balances 2026`).
    static func year(_ d: Date) -> Int { calendar.component(.year, from: d) }

    /// One formatter per format, made once: rows format dates on every render, and making a
    /// `DateFormatter` is slow. Formatting and parsing with one are thread-safe (iOS 7 and later).
    private final class Formatters: @unchecked Sendable {
        private let lock = NSLock()
        private var made: [String: DateFormatter] = [:]

        func get(_ format: String) -> DateFormatter {
            lock.withLock {
                if let f = made[format] { return f }
                let f = DateFormatter()
                f.locale = Locale(identifier: "en_SG")
                f.calendar = Calendar(identifier: .gregorian)
                f.timeZone = Fmt.singapore
                f.dateFormat = format
                made[format] = f
                return f
            }
        }
    }

    private static let formatters = Formatters()

    private static func formatter(_ format: String) -> DateFormatter { formatters.get(format) }

    /// `31 Oct 2026`
    static func date(_ d: Date) -> String { formatter("d MMM yyyy").string(from: d) }
    /// `Fri, 31 Oct`
    static func dayShort(_ d: Date) -> String { formatter("EEE, d MMM").string(from: d) }
    /// `Friday 31 October`, for VoiceOver.
    static func daySpoken(_ d: Date) -> String { formatter("EEEE d MMMM").string(from: d) }
    /// `October 2026`
    static func month(_ d: Date) -> String { formatter("MMMM yyyy").string(from: d) }
    /// `08:58`
    static func time(_ d: Date) -> String { formatter("HH:mm").string(from: d) }
    /// `31 Oct 2026, 08:58`
    static func dateTime(_ d: Date) -> String { formatter("d MMM yyyy, HH:mm").string(from: d) }

    /// Parses `2026-10-31` as a Singapore calendar date.
    static func parseDay(_ s: String) -> Date? { formatter("yyyy-MM-dd").date(from: String(s.prefix(10))) }
    static func day(_ d: Date) -> String { formatter("yyyy-MM-dd").string(from: d) }

    /// The two ISO 8601 formatters, made once (rows parse a timestamp on every render) and used
    /// under a lock.
    private final class ISOFormatters: @unchecked Sendable {
        private let lock = NSLock()
        private let fractional: ISO8601DateFormatter = {
            let f = ISO8601DateFormatter()
            f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return f
        }()
        private let whole: ISO8601DateFormatter = {
            let f = ISO8601DateFormatter()
            f.formatOptions = [.withInternetDateTime]
            return f
        }()

        func parse(_ s: String) -> Date? { lock.withLock { fractional.date(from: s) ?? whole.date(from: s) } }
        func string(_ d: Date) -> String { lock.withLock { fractional.string(from: d) } }
    }

    private static let iso = ISOFormatters()

    /// Parses ISO 8601 timestamps with or without fractional seconds.
    static func parseInstant(_ s: String) -> Date? { iso.parse(s) }

    /// `2026-11-02T00:58:00.000Z`: UTC with milliseconds, as the API expects.
    static func instant(_ d: Date) -> String { iso.string(d) }

    /// `2026-10` → `October 2026`
    static func monthKey(_ s: String) -> String {
        guard let d = parseDay(s + "-01") else { return s }
        return month(d)
    }

    /// `2026-10-31` → `31 Oct 2026`; an instant is shown as its Singapore date.
    static func dayString(_ s: String) -> String {
        if s.count > 10, let instant = parseInstant(s) { return date(instant) }
        return parseDay(s).map(date) ?? s
    }

    /// Today in Singapore, `2026-11-13`.
    static func today(_ now: Date = Date()) -> String { day(now) }

    /// `2026-11-13` plus `n` days (negative goes back), on the Singapore calendar.
    static func addDays(_ s: String, _ n: Int) -> String {
        guard let d = parseDay(s), let next = calendar.date(byAdding: .day, value: n, to: d) else { return s }
        return day(next)
    }

    /// The Monday of the week holding `s` (weeks run Monday to Sunday, as rosters do).
    static func mondayOf(_ s: String) -> String {
        guard let d = parseDay(s) else { return s }
        let weekday = calendar.component(.weekday, from: d) // 1 = Sunday
        return addDays(s, -((weekday + 5) % 7))
    }

    /// `Mon` for `2026-11-16`.
    static func weekday(_ s: String) -> String { parseDay(s).map { formatter("EEE").string(from: $0) } ?? "" }

    /// `9–22 Nov 2026`, `30 Nov – 13 Dec 2026`, `28 Dec 2026 – 10 Jan 2027` (the web's range).
    static func dateRange(_ start: String, _ end: String) -> String {
        guard let s = parseDay(start), let e = parseDay(end) else { return "\(start) – \(end)" }
        if start == end { return date(s) }
        let (ys, ms) = (calendar.component(.year, from: s), calendar.component(.month, from: s))
        let (ye, me) = (calendar.component(.year, from: e), calendar.component(.month, from: e))
        if ys == ye && ms == me { return "\(calendar.component(.day, from: s))–\(date(e))" }
        if ys == ye { return "\(formatter("d MMM").string(from: s)) – \(date(e))" }
        return "\(date(s)) – \(date(e))"
    }

    /// Minutes as `7h 30m`, `8h`, `45m`.
    static func hoursMinutes(_ minutes: Int) -> String {
        let h = minutes / 60, m = minutes % 60
        return h > 0 ? (m > 0 ? "\(h)h \(m)m" : "\(h)h") : "\(m)m"
    }

    /// NRIC/FIN masked as `S****567D`. Anything that isn't 9 characters is fully masked.
    static func maskNRIC(_ id: String) -> String {
        let s = id.trimmingCharacters(in: .whitespaces).uppercased()
        guard s.count == 9 else { return "*********" }
        let chars = Array(s)
        return String(chars[0]) + "****" + String(chars[5...8])
    }

    /// Leave quantities: `1`, `0.5`, `12.5` (days or hours), never `1.0`.
    static func quantity(_ q: Double) -> String {
        let tenths = Int((q * 10).rounded())
        return tenths % 10 == 0 ? String(tenths / 10) : String(format: "%d.%d", tenths / 10, abs(tenths % 10))
    }
}
