import UIKit
import XCTest

/// iPad layouts against the seeded server (iPad simulators only; skipped on an iPhone): the
/// sidebar, the readable column, payslips beside the list, Today in two columns, both
/// orientations, dark mode and the largest text size, the compact width of a one-third Split View
/// (simulated with `-uitest-width`, see `SimulatedSplitView`) and the Command-key
/// shortcuts. Screenshots `ipad-<size>-…` are kept in the xcresult and copied to artifacts/ios/.
///
///   CROWHR_SIM_UDID=<iPad simulator> CROWHR_UI_ONLY=CrowHRUITests/IPadLayoutUITests scripts/ios-ui-test.sh
final class IPadLayoutUITests: CrowUITestCase {
    override func setUpWithError() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "iPad layouts only")
    }

    /// "13" or "11", from the screen's short side in pixels (2064 or 1668).
    private var size: String {
        let image = XCUIScreen.main.screenshot().image
        return min(image.size.width, image.size.height) * image.scale >= 2000 ? "13" : "11"
    }

    private func rotate(_ orientation: UIDeviceOrientation) {
        XCUIDevice.shared.orientation = orientation
        RunLoop.current.run(until: Date().addingTimeInterval(2))
    }

    private func settle(_ seconds: TimeInterval = 1.2) { RunLoop.current.run(until: Date().addingTimeInterval(seconds)) }

    // MARK: Light, both orientations, keyboard

    func testA_LightPortraitAndLandscape() throws {
        let prefix = "ipad-\(size)"
        app.launch()
        // The connect form is a centred, readable column, not a 1000-point-wide field.
        let address = wait(app.textFields["connect.address"])
        shot("\(prefix)-connect")
        XCTAssertLessThanOrEqual(address.frame.width, 560, "Connect field spans \(address.frame.width) pt")
        app.terminate()

        connectAndSignIn(as: Self.employee)
        // Portrait: iPadOS's floating tab bar, with More's screens as tabs and no More.
        XCTAssertTrue(app.buttons.matching(identifier: "tab.claims").firstMatch.waitForExistence(timeout: 10), "Claims should be a tab of its own")
        XCTAssertFalse(moreTab.exists, "More belongs to the phone tab bar only")
        tour(prefix: "\(prefix)-portrait")

        rotate(.landscapeLeft)
        // Landscape: the sidebar, with the organisation at the top.
        wait(element("sidebar.header"))
        XCTAssertNotNil(sidebarItem("Claims"), "Claims should be in the sidebar")
        tour(prefix: "\(prefix)-landscape")
        // Wide: Today's next shifts sit beside the clock card.
        tapTab("Today")
        let clock = wait(app.buttons["clock.button"])
        let shifts = wait(app.staticTexts["NEXT SHIFTS"])
        XCTAssertGreaterThan(shifts.frame.minX, clock.frame.maxX - 1, "Next shifts should be beside the clock card in landscape (clock \(clock.frame), shifts \(shifts.frame))")
        rotate(.portrait)

        // Hardware keyboard: Command-number shortcuts reach each screen.
        app.typeKey("2", modifierFlags: .command)
        wait(element("leave.balance"))
        app.typeKey("3", modifierFlags: .command)
        wait(app.staticTexts["payslip.net"])
        app.typeKey("8", modifierFlags: .command)
        wait(app.buttons["settings.signOut"])
        app.typeKey("1", modifierFlags: .command)
        wait(app.staticTexts["today.greeting"])
    }

    /// Today, Leave, Payslips (the list beside the latest payslip, unless the area is narrow),
    /// Inbox, Claims, Settings.
    private func tour(prefix: String) {
        tapTab("Today")
        wait(app.staticTexts["today.greeting"])
        settle()
        shot("\(prefix)-today")

        tapTab("Leave")
        wait(element("leave.balance"))
        settle()
        shot("\(prefix)-leave")

        tapTab("Pay")
        let row = wait(element("payslip.row"), 20)
        // Side by side, the latest payslip is already open next to the list.
        let net = app.staticTexts["payslip.net"]
        if net.waitForExistence(timeout: 5) {
            XCTAssertTrue(row.exists, "The payslip list should stay beside the payslip")
        } else {
            row.tap()
            wait(net)
        }
        settle()
        shot("\(prefix)-payslips")

        tapTab("Inbox")
        settle(1.5)
        shot("\(prefix)-inbox")

        openFromMore("more.claims", sidebar: "Claims")
        wait(app.buttons["claims.new"])
        settle()
        shot("\(prefix)-claims")
        app.buttons["claims.new"].tap()
        wait(app.textFields["claim.merchant"])
        settle()
        shot("\(prefix)-new-claim")
        // A page-sized sheet: the whole form shows, Submit included (the form-sized one hid it).
        XCTAssertTrue(app.buttons["claim.submit"].isHittable, "New claim's Submit should be on screen without scrolling (\(prefix))")
        app.buttons["Cancel"].firstMatch.tap()

        openFromMore("more.settings", sidebar: "Settings")
        wait(app.buttons["settings.signOut"])
        settle()
        shot("\(prefix)-settings")
    }

    // MARK: Dark landscape, and the largest text size

    func testB_DarkLandscape() throws {
        useAppearance(dark: true, xxxl: false)
        connectAndSignIn(as: Self.employee)
        rotate(.landscapeRight)
        let prefix = "ipad-\(size)-dark-landscape"
        tapTab("Today"); settle(); shot("\(prefix)-today")
        tapTab("Pay"); wait(app.staticTexts["payslip.net"], 20); settle(); shot("\(prefix)-payslips")
        tapTab("Leave"); wait(element("leave.balance")); settle(); shot("\(prefix)-leave")
        rotate(.portrait)
        tapTab("Today"); settle(); shot("ipad-\(size)-dark-portrait-today")
    }

    func testC_AccessibilityXXXL() throws {
        useAppearance(dark: false, xxxl: true)
        connectAndSignIn(as: Self.employee)
        let prefix = "ipad-\(size)-xxxl"
        settle(); shot("\(prefix)-portrait-today")
        tapTab("Pay")
        wait(element("payslip.row"), 20)
        if !app.staticTexts["payslip.net"].waitForExistence(timeout: 3) { element("payslip.row").tap() }
        wait(app.staticTexts["payslip.net"])
        settle(); shot("\(prefix)-portrait-payslip")
        rotate(.landscapeLeft)
        tapTab("Today"); settle(); shot("\(prefix)-landscape-today")
        tapTab("Leave"); wait(element("leave.balance")); settle(); shot("\(prefix)-landscape-leave")
        tapTab("Pay"); settle(); shot("\(prefix)-landscape-payslips")
        rotate(.portrait)
    }

    // MARK: Approvals beside the list

    func testE_ApprovalsBesideTheList() throws {
        connectAndSignIn(as: Self.manager)
        let prefix = "ipad-\(size)-approvals"
        tapTab("Inbox")
        let row = wait(app.buttons["approval.row"].firstMatch, 20)
        // The first request is open beside the list, with its details: no sheet.
        let approve = wait(app.buttons["decision.approve"])
        wait(element("decision.details"), 20)
        XCTAssertFalse(app.navigationBars["Decision"].exists, "On an iPad with room the decision is not a sheet")
        XCTAssertGreaterThan(approve.frame.minX, row.frame.maxX - 1, "The decision should sit beside the list (row \(row.frame), approve \(approve.frame))")
        settle(); shot("\(prefix)-portrait")
        // Choosing another request opens it in place.
        let rows = app.buttons.matching(identifier: "approval.row")
        if rows.count > 1 {
            rows.element(boundBy: 1).tap()
            wait(element("decision.details"), 20)
            XCTAssertTrue(rows.element(boundBy: 1).isSelected, "The open request's row is selected")
        }
        rotate(.landscapeLeft)
        wait(app.buttons["decision.approve"])
        settle(); shot("\(prefix)-landscape")
        rotate(.portrait)
    }

    // MARK: Compact width (one-third Split View, Slide Over)

    func testD_CompactWidth() throws {
        app.launchArguments += ["-uitest-width", "375"]
        connectAndSignIn(as: Self.employee)
        let prefix = "ipad-\(size)-compact"
        settle(2)
        shot("\(prefix)-signed-in")
        // The phone's tab bar, with More, and no sidebar.
        if !moreTab.waitForExistence(timeout: 10) { print("COMPACT TREE \(app.debugDescription)") }
        XCTAssertTrue(moreTab.exists, "Compact width should show the tab bar with More")
        XCTAssertFalse(element("sidebar.header").exists, "No sidebar at a compact width")
        let greeting = wait(app.staticTexts["today.greeting"])
        XCTAssertLessThan(greeting.frame.maxX, 376, "Today should lay out in the 375-point strip")
        settle(); shot("\(prefix)-today")
        tapTab("Leave"); wait(element("leave.balance")); settle(); shot("\(prefix)-leave")
        // Payslips collapse to the list, which pushes the payslip.
        tapTab("Pay")
        let row = wait(element("payslip.row"), 20)
        XCTAssertFalse(app.staticTexts["payslip.net"].exists, "At a compact width the list comes first")
        row.tap()
        wait(app.staticTexts["payslip.net"])
        settle(); shot("\(prefix)-payslip")
        // Claims and Settings are under More, as on a phone.
        XCTAssertTrue(openFromMore("more.claims", sidebar: "Claims"))
        wait(app.buttons["claims.new"])
        settle(); shot("\(prefix)-claims")
        // A screen chosen with the keyboard that the tab bar doesn't show opens under More.
        tapTab("Today")
        app.typeKey("8", modifierFlags: .command)
        settle()
        shot("\(prefix)-shortcut-settings")
        wait(app.buttons["settings.signOut"])
        settle(); shot("\(prefix)-settings")
    }
}
