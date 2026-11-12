import Foundation
import Testing
import UIKit
@testable import CrowHR

/// Foreign-currency and multi-line claims: the shared money rules in
/// apps/mobile-fixtures/claim-money-cases.json (the web form's and the server's), then the form's
/// own logic (messages, the receipt rule on the SGD amount, what is missing, the request).
@Suite("Claim form")
struct ClaimFormTests {
    static var root: [String: Any] { Fixtures.json("claim-money-cases.json") as? [String: Any] ?? [:] }

    private func int(_ v: Any?) -> Int? { (v as? NSNumber)?.intValue }

    @Test func currenciesAreTheWebFormsList() throws {
        let cases = try #require(Self.root["currencies"] as? [[String: Any]])
        #expect(ClaimMoney.currencies.map(\.code) == cases.map { $0["code"] as! String })
        for c in cases { #expect(ClaimMoney.exponent(of: c["code"] as! String) == int(c["exponent"])) }
        #expect(ClaimMoney.exponent(of: "XYZ") == 2)
    }

    @Test func amountsParseInMinorUnits() throws {
        let cases = try #require(Self.root["parseMinor"] as? [[String: Any]])
        #expect(cases.count >= 10)
        for c in cases {
            #expect(ClaimMoney.parseMinor(c["text"] as! String, exponent: int(c["exponent"])!) == int(c["minor"]), "\(c)")
        }
    }

    @Test func amountsFormat() throws {
        for c in try #require(Self.root["formatMinor"] as? [[String: Any]]) {
            #expect(ClaimMoney.formatMinor(int(c["minor"])!, exponent: int(c["exponent"])!) == c["text"] as? String)
        }
        for c in try #require(Self.root["foreignAmount"] as? [[String: Any]]) {
            #expect(ClaimMoney.foreignAmount(currency: c["currency"] as! String, amountMinor: int(c["amountMinor"])!) == c["text"] as? String)
        }
    }

    @Test func ratesParseInMillionths() throws {
        for c in try #require(Self.root["parseRateMicros"] as? [[String: Any]]) {
            #expect(ClaimMoney.parseRateMicros(c["text"] as! String) == int(c["micros"]), "\(c)")
        }
    }

    @Test func sgdAmountsRoundHalfUpOncePerLine() throws {
        for c in try #require(Self.root["toSgdCents"] as? [[String: Any]]) {
            let cents = ClaimMoney.toSgdCents(amountMinor: int(c["amountMinor"])!, exponent: int(c["exponent"])!, rateMicros: int(c["rateMicros"])!)
            #expect(cents == int(c["cents"]), "\(c)")
        }
        for c in try #require(Self.root["previewSgd"] as? [[String: Any]]) {
            let cents = ClaimMoney.previewSgd(currency: c["currency"] as! String, amountMinor: int(c["amountMinor"]), rate: c["rate"] as? String)
            #expect(cents == int(c["cents"]), "\(c)")
        }
    }

    @Test func theReceiptRuleUsesTheSgdAmount() throws {
        for c in try #require(Self.root["receiptRequired"] as? [[String: Any]]) {
            let t = ClaimType(id: "t", name: "Meals", category: "meals", receiptRule: c["rule"] as! String, receiptAboveCents: int(c["aboveCents"]), receiptHint: "")
            #expect(t.receiptRequired(sgdCents: int(c["sgdCents"])) == (c["required"] as! Bool), "\(c)")
        }
    }

    @Test func messagesAreTheWebFormsAndShowOnlyOnceTyped() throws {
        let m = try #require(Self.root["messages"] as? [String: String])
        var l = ClaimLineDraft(typeID: "t", date: Date())
        #expect(l.amountError == nil && l.rateError == nil)
        l.amount = "12.345"
        #expect(l.amountError == m["amount"])
        l.currency = "JPY"
        l.amount = "50.5"
        #expect(l.amountError == m["wholeAmount"])
        l.amount = "5000"
        #expect(l.amountError == nil)
        #expect(l.rateError == nil, "No rate typed yet: nothing to fix")
        l.rate = "0.0089123"
        #expect(l.rateError == m["rate"]?.replacingOccurrences(of: "{currency}", with: "JPY"))
        l.rate = "0.008912"
        #expect(l.rateError == nil)
        #expect(l.sgdCents == 4456)
    }

    private let meals = ClaimType(id: "meals", name: "Meals", category: "meals", receiptRule: "above", receiptAboveCents: 1000, receiptHint: "Receipts above S$10.00")
    private let taxi = ClaimType(id: "taxi", name: "Transport", category: "transport", receiptRule: "never", receiptAboveCents: nil, receiptHint: "")

    @MainActor
    @Test func aForeignLineNeedsTheRateAndItsReceiptFollowsTheSgdAmount() {
        var l = ClaimLineDraft(typeID: "meals", date: Date())
        l.merchant = "Restoran Rebung"
        l.detail = "Client lunch in KL"
        l.currency = "MYR"
        l.amount = "30.00"
        #expect(l.missing(meals) == ["the rate"])
        l.rate = "0.30"
        // MYR 30.00 at 0.30 is S$9.00: under the S$10.00 threshold, no receipt.
        #expect(l.sgdCents == 900)
        #expect(!l.receiptRequired(meals))
        #expect(l.missing(meals).isEmpty)
        l.amount = "40.00"
        #expect(l.sgdCents == 1200)
        #expect(l.missing(meals) == ["a photo of the receipt"])
        l.receipt = CapturedImage(image: CameraCapture.stubReceipt())
        #expect(l.missing(meals).isEmpty)
        let line = l.line(receiptIDs: ["r1"])
        #expect(line == NewClaim.Line(claimTypeId: "meals", expenseDate: Fmt.day(l.date), merchant: "Restoran Rebung", description: "Client lunch in KL",
                                      currency: "MYR", amountMinor: 4000, rate: "0.30", receiptIds: ["r1"]))
    }

    @Test func anSgdLineSendsNoRate() throws {
        var l = ClaimLineDraft(typeID: "taxi", date: Date())
        l.merchant = "Grab"
        l.detail = "Taxi to the client"
        l.amount = "18.40"
        l.rate = "1.5" // left from a foreign currency: not sent
        let line = try #require(l.line(receiptIDs: []))
        #expect(line.rate == nil && line.currency == "SGD" && line.amountMinor == 1840)
        let json = try #require(String(data: JSONEncoder().encode(line), encoding: .utf8))
        #expect(!json.contains("rate"))
    }

    @MainActor
    @Test func theMissingHintNamesEachExpense() {
        var one = ClaimLineDraft(typeID: "meals", date: Date())
        #expect(ClaimForm.missingHint([one], types: [meals]) == "To submit, add the merchant, what it was for and the amount.")
        one.merchant = "Kopi Kaki"
        one.detail = "Team breakfast"
        one.amount = "12.50"
        #expect(ClaimForm.missingHint([one], types: [meals]) == "To submit, add a photo of the receipt.")
        one.receipt = CapturedImage(image: CameraCapture.stubReceipt())
        #expect(ClaimForm.missingHint([one], types: [meals]) == nil)

        var two = ClaimLineDraft(typeID: "taxi", date: Date())
        two.currency = "USD"
        two.amount = "20"
        var three = ClaimLineDraft(typeID: "", date: Date())
        three.merchant = "x"
        three.detail = "y"
        three.amount = "1"
        #expect(ClaimForm.missingHint([one, two, three], types: [meals, taxi])
            == "To submit, add the merchant, what it was for and the rate to expense 2, and the claim type to expense 3.")
    }

    @Test func theTotalIsTheSumOfRoundedLines() {
        var a = ClaimLineDraft(typeID: "meals", date: Date())
        a.currency = "MYR"
        a.amount = "125.50"
        a.rate = "0.301234" // S$37.804867 → S$37.80
        var b = ClaimLineDraft(typeID: "taxi", date: Date())
        b.amount = "18.40"
        var c = ClaimLineDraft(typeID: "taxi", date: Date())
        c.amount = "abc" // not counted until valid
        #expect(ClaimForm.total([a, b, c]) == 3780 + 1840)
        #expect(ClaimForm.identifier("claim.amount", line: 0) == "claim.amount")
        #expect(ClaimForm.identifier("claim.amount", line: 1) == "claim.amount.2")
    }

    @MainActor
    @Test func aClaimDecodesWithForeignLinesAndSaysHowItIsPaid() throws {
        let json = #"""
        {"id":"c1","claimNumber":"C-0007","status":"approved","title":null,"employee":{"id":"e","name":"Nurul Huda","employeeNumber":"E1","departmentName":null},
         "totalCents":5620,"gstCents":0,"payoutMethod":"payroll","reservedByPayrollRun":false,"paidVia":null,"paidOn":null,"paidReference":null,
         "submittedAt":"2026-11-12T02:00:00.000Z","approvedOn":"2026-11-13","decisionComment":null,"lines":[
           {"id":"l1","position":0,"claimTypeId":"t","typeCode":"MEALS","typeName":"Meals","category":"meals","expenseDate":"2026-11-10","merchant":"Restoran Rebung","description":"Client lunch","receipts":[],"receiptCount":1,
            "currency":"MYR","amountMinor":12550,"rate":"0.301234","sgdCents":3780,"gstCents":null,"receiptRequired":true,"duplicates":[]},
           {"id":"l2","position":1,"claimTypeId":"t2","typeCode":"TAXI","typeName":"Transport","category":"transport","expenseDate":"2026-11-10","merchant":"Grab","description":"Taxi","receiptCount":0,
            "currency":"SGD","amountMinor":1840,"rate":null,"sgdCents":1840,"gstCents":null,"receiptRequired":false,"duplicates":[]}],
         "capUsage":[],"actions":{"edit":false,"submit":false,"delete":false,"withdraw":false,"copy":true}}
        """#
        let c = try JSONDecoder().decode(ClaimDetail.self, from: Data(json.utf8))
        #expect(c.heading == "2 expenses")
        #expect(c.payout == "With the next payroll")
        #expect(ClaimLineRow(line: c.lines[0]).foreign == "MYR 125.50 @ 0.301234")
        #expect(ClaimLineRow(line: c.lines[1]).foreign == nil)
        #expect(ClaimSummary.statusLabel("submitted") == ("Waiting", .warning))
    }
}
