import XCTest

/// App Store screenshots: the real app against the seeded test server (fictional e2e data plus
/// scripts/ios-ui-seed.ts and scripts/ios-store-seed.ts), light mode, default text size, the
/// test-only controls hidden (`-uitest-store`). Run on the 6.9-inch store simulator with a demo
/// status bar:
///
///   CROWHR_SIM_UDID=<store simulator> CROWHR_UI_ONLY=CrowHRUITests/StoreScreenshotsUITests \
///     CROWHR_UI_STORE_SEED=1 CROWHR_STATUS_BAR=demo scripts/ios-ui-test.sh
///
/// The `store-*` attachments land in artifacts/ios/; apps/ios/store/screenshots/ keeps the chosen
/// ones. Not part of the release gate.
final class StoreScreenshotsUITests: CrowUITestCase {
    override func setUp() {
        super.setUp()
        app.launchArguments.append("-uitest-store")
    }

    func test1_Employee() throws {
        connectAndSignIn(as: Self.employee)

        // Today: the clock-in card, with the published shifts below.
        wait(app.buttons["clock.button"])
        wait(app.staticTexts["Tanjong Pagar HQ"].firstMatch, 20)
        RunLoop.current.run(until: Date().addingTimeInterval(1.5))
        shot("store-01-today")

        // Payslip: last month's, released by HR.
        tapTab("Pay")
        wait(app.buttons["payslip.row"].firstMatch, 20).tap()
        wait(app.staticTexts["payslip.net"])
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        shot("store-02-payslip")

        // Leave balances, then an application with its live quote.
        tapTab("Leave")
        wait(app.descendants(matching: .any)["leave.balance"].firstMatch)
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        shot("store-03-leave")
        app.buttons["leave.apply"].tap()
        wait(app.staticTexts["leave.quote"], 20)
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        shot("store-04-leave-apply")
        let apply = app.buttons["leave.submit"]
        eventually("Apply to be enabled") { apply.isEnabled }
        apply.tap()
        wait(app.descendants(matching: .any)["leave.request"].firstMatch)

        // A claim with the receipt photographed (the simulator's stubbed camera).
        tapTab("More")
        wait(app.buttons["more.claims"]).tap()
        wait(app.buttons["claims.new"]).tap()
        // The amount first, so the last field typed in has a return key that closes the keyboard.
        wait(app.textFields["claim.amount"]).tap()
        app.textFields["claim.amount"].typeText("12.50")
        app.textFields["claim.merchant"].tap()
        app.textFields["claim.merchant"].typeText("Kopi Kaki Cafe")
        app.textFields["claim.description"].tap()
        app.textFields["claim.description"].typeText("Breakfast with a supplier\n")
        app.buttons["claim.camera"].tap()
        wait(app.buttons["camera.shutter"]).tap()
        wait(app.images["claim.receiptPreview"])
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        shot("store-05-claim")
        let submit = app.buttons["claim.submit"]
        for _ in 0..<4 where !submit.isHittable { app.swipeUp() }
        submit.tap()
        wait(app.descendants(matching: .any)["claim.row"].firstMatch, 20)
    }

    func test2_ManagerApprovals() throws {
        connectAndSignIn(as: Self.manager)
        tapTab("Inbox")
        wait(app.buttons["approval.row"].firstMatch, 20)
        RunLoop.current.run(until: Date().addingTimeInterval(1.5))
        shot("store-06-approvals")
        let leave = app.buttons.matching(NSPredicate(format: "identifier == 'approval.row' AND label CONTAINS 'Nurul Huda' AND label CONTAINS 'leave'")).firstMatch
        (leave.exists ? leave : app.buttons["approval.row"].firstMatch).tap()
        wait(app.buttons["decision.approve"])
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        shot("store-07-approval-detail")
    }
}
