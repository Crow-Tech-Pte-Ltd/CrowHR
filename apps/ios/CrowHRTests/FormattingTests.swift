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
