import Foundation
import Testing
@testable import CrowHR

/// Singapore conventions, from apps/mobile-fixtures/format-cases.json (shared with Android and
/// packages/ui/src/lib/format.ts).
@Suite("Formatting")
struct FormattingTests {
    static var root: [String: Any] { Fixtures.json("format-cases.json") as? [String: Any] ?? [:] }

    @Test func money() throws {
        let cases = try #require(Self.root["money"] as? [[String: Any]])
        #expect(cases.count >= 5)
        for c in cases { #expect(Fmt.money(cents: (c["cents"] as! NSNumber).intValue) == c["text"] as? String) }
    }

    @Test func moneyParsing() throws {
        let cases = try #require(Self.root["moneyParse"] as? [[String: Any]])
        for c in cases {
            let r = Fmt.parseMoney(c["input"] as! String)
            if let cents = c["cents"] as? Int { #expect(r == .success(cents), "\(c)") }
            if let error = c["error"] as? String { #expect(r == .failure(Fmt.MoneyParseError(rawValue: error)!), "\(c)") }
        }
        #expect(Fmt.parseCents("0") == nil) // a claim needs a positive amount
    }

    @Test func dates() throws {
        for c in try #require(Self.root["dates"] as? [[String: String]]) { #expect(Fmt.dayString(c["iso"]!) == c["text"]) }
        let dt = try #require((Self.root["dateTimes"] as? [String: Any])?["cases"] as? [[String: String]])
        for c in dt {
            let d = try #require(Fmt.parseInstant(c["instant"]!))
            #expect(Fmt.time(d) == c["time"])
            #expect(Fmt.dateTime(d) == c["dateTime"])
        }
    }

    @Test func instantsParseWithAndWithoutFractionsAndRoundTrip() async throws {
        let whole = try #require(Fmt.parseInstant("2026-11-02T00:58:00Z"))
        let fractional = try #require(Fmt.parseInstant("2026-11-02T00:58:00.250Z"))
        #expect(fractional.timeIntervalSince(whole) == 0.25)
        #expect(Fmt.parseInstant("2026-11-02") == nil)
        #expect(Fmt.instant(fractional) == "2026-11-02T00:58:00.250Z")
        #expect(Fmt.parseInstant(Fmt.instant(whole)) == whole)
        // The shared formatters are used from many tasks at once (rows, the punch sender).
        let parsed = await withTaskGroup(of: Date?.self) { group in
            for i in 0..<200 { group.addTask { Fmt.parseInstant(i.isMultiple(of: 2) ? "2026-11-02T00:58:00Z" : "2026-11-02T00:58:00.250Z") } }
            return await group.reduce(into: [Date?]()) { $0.append($1) }
        }
        #expect(parsed.allSatisfy { $0 == whole || $0 == fractional })
    }

    @Test func nric() throws {
        for c in try #require(Self.root["nric"] as? [[String: String]]) { #expect(Fmt.maskNRIC(c["value"]!) == c["masked"]) }
    }

    @Test func moneyIsSpokenInWords() {
        #expect(Fmt.moneySpoken(cents: 123_456) == "1,234 Singapore dollars 56 cents")
    }

    @Test func quantities() {
        #expect(Fmt.quantity(1) == "1")
        #expect(Fmt.quantity(0.5) == "0.5")
        #expect(Fmt.quantity(12.5) == "12.5")
    }
}
