import UIKit
import XCTest

/// Task 3.5: the ESS journey against a real, seeded Crow HR server (scripts/ios-ui-server.sh on
/// Linux, reached through an SSH reverse tunnel bound to the Mac's loopback). Sign-in goes through
/// the real ASWebAuthenticationSession and the server's web sign-in page. Every test ends by
/// asserting the network allow-list: the app contacted only the test server.
///
/// Run by scripts/ios-ui-test.sh, which passes TEST_RUNNER_CROWHR_TEST_SERVER.
/// Shared helpers: launch, connect, sign in through the system browser, assert the allow-list.
class CrowUITestCase: XCTestCase {
    /// Fictional e2e data (e2e/fixtures.ts).
    static let password = "kopi peng siew dai 2026"
    static let employee = "nurul@kampongkopi.example" // Nurul Huda, rostered crew, reports to Kai Wen
    static let manager = "kaiwen@kampongkopi.example" // Wong Kai Wen, approver

    var server: String { ProcessInfo.processInfo.environment["CROWHR_TEST_SERVER"] ?? "http://127.0.0.1:3190" }
    var app: XCUIApplication!
    /// QA (task 3.7): called with a screen name and a screenshot slug on each connect and sign-in
    /// screen on the way in, to audit it.
    var checkScreen: ((_ screen: String, _ slug: String) -> Void)?

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-uitest", "-uitest-reset", "-uitest-camera-stub"]
        if isPad {
            // A test that rotated the iPad must not leave the next one in landscape.
            XCUIDevice.shared.orientation = .portrait
            // On an iPad the sign-in browser from the previous test's sign-in can stay running and
            // never report idle, so every step in the next sign-in waited 60 s (and timed out).
            let browser = XCUIApplication(bundleIdentifier: "com.apple.SafariViewService")
            if browser.state != .notRunning { browser.terminate() }
        }
    }

    var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

    /// Dark appearance and an accessibility text size, for QA (task 3.7).
    func useAppearance(dark: Bool, xxxl: Bool) {
        if dark { app.launchArguments.append("-uitest-dark") }
        if xxxl { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] }
    }

    // MARK: Helpers

    func shot(_ name: String) {
        let a: XCTAttachment
        if XCUIDevice.shared.orientation.isLandscape {
            // An iPad in landscape: the app's own screenshot keeps a portrait frame and crops, and
            // the screen's carries its rotation only as metadata a PNG attachment drops. Redraw it
            // upright.
            let image = XCUIScreen.main.screenshot().image
            let format = UIGraphicsImageRendererFormat()
            format.scale = image.scale
            let upright = UIGraphicsImageRenderer(size: image.size, format: format).image { _ in image.draw(at: .zero) }
            a = XCTAttachment(data: upright.pngData() ?? Data(), uniformTypeIdentifier: "public.png")
        } else {
            a = XCTAttachment(screenshot: app.screenshot())
        }
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }

    @discardableResult
    func wait(_ e: XCUIElement, _ timeout: TimeInterval = 15, _ file: StaticString = #filePath, _ line: UInt = #line) -> XCUIElement {
        XCTAssertTrue(e.waitForExistence(timeout: timeout), "Missing \(e)", file: file, line: line)
        return e
    }

    /// Polls `condition` until it holds (UI updates arrive asynchronously).
    func eventually(_ what: String, timeout: TimeInterval = 20, _ condition: () -> Bool, file: StaticString = #filePath, line: UInt = #line) {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        XCTFail("Timed out waiting for \(what)", file: file, line: line)
    }

    /// Web fields in the system browser sometimes need a second tap before they take focus.
    func focusAndType(_ field: XCUIElement, _ text: String, file: StaticString = #filePath, line: UInt = #line) {
        for _ in 0..<4 {
            field.tap()
            RunLoop.current.run(until: Date().addingTimeInterval(0.8))
            if (field.value(forKey: "hasKeyboardFocus") as? Bool) == true {
                field.typeText(text)
                return
            }
        }
        XCTFail("\(field) never took keyboard focus", file: file, line: line)
    }

    /// On a busy Mac, typing into the system browser sometimes drops keys ("kamponi" for
    /// "kampongkopi"), and the server then refuses the sign-in. The field still has focus with the
    /// cursor at the end: compare (a password by its number of bullets), clear and type again.
    func retypeIfKeysDropped(_ field: XCUIElement, _ text: String, secure: Bool = false, file: StaticString = #filePath, line: UInt = #line) {
        func typed() -> String? { field.value as? String }
        func ok() -> Bool {
            guard let value = typed(), !value.isEmpty else { return true } // unreadable: don't judge
            if secure { return !value.allSatisfy { $0 == "•" } || value.count == text.count }
            return value == text
        }
        for _ in 0..<2 where !ok() {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: typed()?.count ?? 0) + text)
        }
        XCTAssertTrue(ok(), "The system browser field holds \(secure ? "\(typed()?.count ?? 0) characters" : "'\(typed() ?? "")'"), not what was typed", file: file, line: line)
    }

    /// Any element with this accessibility identifier (a row can be a button or a cell).
    func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    /// The row for a screen in the iPad sidebar, if the sidebar is showing.
    func sidebarItem(_ label: String) -> XCUIElement? {
        for e in [app.collectionViews.cells[label], app.cells[label], app.collectionViews.buttons[label]] where e.exists && e.isHittable {
            return e
        }
        return nil
    }

    /// The first of `query`'s elements that is on screen and can be tapped (the app's keyboard
    /// shortcuts also appear in the tree as zero-size buttons named like the tabs).
    func hittable(_ query: XCUIElementQuery) -> XCUIElement? {
        query.allElementsBoundByIndex.first { $0.exists && $0.isHittable && $0.frame.width > 1 }
    }

    /// A main screen's tab: the tab bar on a phone (and an iPad at compact widths), the sidebar or
    /// the floating tab bar on an iPad, where "Pay" reads "Payslips". `MainTabView` names each tab
    /// `tab.<screen>`. A screen the floating bar leaves to the sidebar (Schedule, Profile, Settings)
    /// is opened through its sidebar button.
    func tabItem(_ label: String) -> XCUIElement? {
        let labels = label == "Pay" ? ["Pay", "Payslips"] : label == "Profile" ? ["Profile", "My profile"] : [label]
        let id = "tab." + (label == "Pay" ? "pay" : label.lowercased().replacingOccurrences(of: "my ", with: ""))
        if let e = hittable(app.tabBars.buttons.matching(NSPredicate(format: "label IN %@", labels))) { return e }
        if let e = hittable(app.buttons.matching(identifier: id)) { return e }
        if let e = hittable(app.cells.matching(identifier: id)) { return e }
        for l in labels { if let row = sidebarItem(l) { return row } }
        return hittable(app.buttons.matching(NSPredicate(format: "label IN %@", labels)))
    }

    func tapTab(_ label: String, file: StaticString = #filePath, line: UInt = #line) {
        var openedSidebar = false
        let start = Date()
        repeat {
            if let item = tabItem(label) { item.tap(); return }
            let toggle = app.buttons["ToggleSideBar"]
            if !openedSidebar, isPad, Date().timeIntervalSince(start) > 2, toggle.exists, toggle.isHittable {
                toggle.tap()
                openedSidebar = true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date().timeIntervalSince(start) < 8
        XCTFail("No tab or sidebar item \(label): \(app.debugDescription)", file: file, line: line)
    }

    /// The phone tab bar's More (also an iPad's at compact widths).
    var moreTab: XCUIElement {
        if app.tabBars.buttons["More"].exists { return app.tabBars.buttons["More"] }
        let byID = app.buttons.matching(identifier: "tab.more").firstMatch
        return byID.exists ? byID : app.buttons["More"].firstMatch
    }

    /// A screen kept under More on a phone; on an iPad at regular width a tab of its own (sidebar
    /// or floating tab bar). Returns true when it was pushed on More's stack (go back from it with
    /// the navigation bar's back button).
    @discardableResult
    func openFromMore(_ identifier: String, sidebar label: String) -> Bool {
        if isPad && !moreTab.waitForExistence(timeout: 2) {
            tapTab(label)
            return false
        }
        tapTab("More")
        wait(app.buttons[identifier]).tap()
        return true
    }

    func connectAndSignIn(as email: String) {
        app.launch()
        let address = wait(app.textFields["connect.address"])
        checkScreen?("Connect", "connect")
        address.tap()
        address.typeText(server)
        app.buttons["connect.continue"].tap()
        // This install hosts two organisations, so the server asks which one (as a QR code would say).
        let org = wait(app.textFields["connect.org"])
        shot("00-organisation-required")
        checkScreen?("Connect, organisation ID", "connect-org")
        org.tap()
        org.typeText("kampong-kopi")
        app.buttons["connect.continue"].tap()
        XCTAssertEqual(wait(app.staticTexts["confirm.orgName"]).label, "Kampong Kopi Pte. Ltd.")
        XCTAssertTrue(app.staticTexts["confirm.insecure"].exists || app.otherElements["confirm.insecure"].exists,
                      "Plain-http private address must show the not-encrypted warning")
        // The organisation's logo, served by the same server (meta logoUrl).
        wait(app.images["org.logo"], 10)
        shot("01-confirm-server")
        checkScreen?("Confirm server", "confirm")
        app.buttons["confirm.connect"].tap()
        wait(app.buttons["signin.start"])
        wait(app.images["org.logo"], 10)
        shot("01b-sign-in")
        checkScreen?("Sign in", "sign-in")
        app.buttons["signin.start"].tap()

        // The system browser session (SafariViewService), showing the server's own sign-in page.
        let browser = XCUIApplication(bundleIdentifier: "com.apple.SafariViewService")
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let consent = springboard.buttons["Continue"]
        if consent.waitForExistence(timeout: 3) { consent.tap() }
        let emailField = browser.textFields["Work email"].exists ? browser.textFields["Work email"] : browser.webViews.textFields.firstMatch
        XCTAssertTrue(emailField.waitForExistence(timeout: 30), "The sign-in page did not open in the system browser")
        focusAndType(emailField, email)
        retypeIfKeysDropped(emailField, email)
        let pass = browser.secureTextFields.firstMatch
        XCTAssertTrue(pass.waitForExistence(timeout: 5))
        // The password field can sit under the keyboard: move to it with the keyboard's Next key.
        let next = browser.buttons["Next"].firstMatch
        if next.exists && next.isEnabled { next.tap() }
        RunLoop.current.run(until: Date().addingTimeInterval(0.8))
        if (pass.value(forKey: "hasKeyboardFocus") as? Bool) == true {
            pass.typeText(Self.password)
        } else {
            focusAndType(pass, Self.password)
        }
        retypeIfKeysDropped(pass, Self.password, secure: true)
        let screenshotOfBrowser = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshotOfBrowser.name = "02-system-browser-sign-in"
        screenshotOfBrowser.lifetime = .keepAlways
        add(screenshotOfBrowser)
        // iOS may offer to save the password (system UI, not the app): decline it through
        // XCUITest's interruption handling.
        let monitor = addUIInterruptionMonitor(withDescription: "Save Password") { alert in
            let notNow = alert.buttons["Not Now"]
            if notNow.exists { notNow.tap(); return true }
            return false
        }
        defer { removeUIInterruptionMonitor(monitor) }
        pass.typeText("\n") // submit the form (the keyboard covers its button)
        let greeting = app.staticTexts["today.greeting"]
        let deadline = Date().addingTimeInterval(40)
        while !greeting.exists && Date() < deadline {
            for owner in [app!, browser, springboard] {
                let notNow = owner.buttons["Not Now"].firstMatch
                if notNow.exists {
                    // A coordinate tap: the alert belongs to another system process, and an element
                    // tap races XCUITest's own interruption handling.
                    // At large text sizes the alert scrolls: tap the part of the button inside it.
                    let alert = owner.alerts.firstMatch
                    let f = alert.exists ? notNow.frame.intersection(alert.frame) : notNow.frame
                    if f.isNull || f.height < 8 {
                        alert.swipeUp()
                    } else {
                        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: f.midX, dy: f.midY)).tap()
                    }
                    break
                }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        wait(greeting, 5)
    }

    /// Settings shows every origin the app's transport contacted (UI-test builds only).
    func assertOnlyTalkedToTheTestServer() {
        openFromMore("more.settings", sidebar: "Settings")
        let origins = app.staticTexts["debug.networkOrigins"]
        for _ in 0..<8 where !origins.exists { app.swipeUp() }
        wait(origins)
        let list = origins.label.split(separator: " ").map(String.init)
        XCTAssertFalse(list.isEmpty, "No requests were recorded")
        XCTAssertEqual(Set(list), [server], "The app contacted something other than the test server: \(list)")
    }

}

final class EssJourneyUITests: CrowUITestCase {
    // MARK: Journeys

    func test1_EmployeeJourney() throws {
        connectAndSignIn(as: Self.employee)
        XCTAssertEqual(app.staticTexts["today.greeting"].label, "Hi, Nurul")
        shot("03-today")

        // Clock in online: sent at once.
        app.buttons["clock.button"].tap()
        XCTAssertEqual(wait(app.staticTexts["clock.message"]).label, "Clocked in.")
        XCTAssertEqual(app.staticTexts["clock.status"].label, "Clocked in")

        // Clock out with no signal: queued on the phone, then sent when the signal returns.
        let outage = wait(app.switches["debug.outage"])
        outage.switches.firstMatch.exists ? outage.switches.firstMatch.tap() : outage.tap()
        app.buttons["clock.button"].tap()
        XCTAssertTrue(wait(app.staticTexts["clock.message"]).label.hasPrefix("Saved on this phone"))
        XCTAssertTrue(app.staticTexts["Waiting to send"].exists || app.staticTexts["Not sent yet. The app will retry automatically."].exists)
        shot("04-punch-queued-offline")
        outage.switches.firstMatch.exists ? outage.switches.firstMatch.tap() : outage.tap()
        wait(app.buttons["clock.sendNow"]).tap()
        let pending = app.staticTexts.matching(NSPredicate(format: "label IN %@", ["Waiting to send", "Not sent yet. The app will retry automatically."]))
        eventually("queued punch to sync") { pending.count == 0 }
        XCTAssertEqual(app.staticTexts["clock.status"].label, "Not clocked in")
        shot("05-punch-synced")

        // Schedule: this week's published roster.
        app.swipeUp()
        XCTAssertTrue(element("shift.row").waitForExistence(timeout: 10) || app.staticTexts["No shifts in the next two weeks."].exists)

        // Leave: balances, apply, see it pending.
        tapTab("Leave")
        wait(app.descendants(matching: .any)["leave.balance"].firstMatch)
        shot("06-leave")
        app.buttons["leave.apply"].tap()
        wait(app.staticTexts["leave.quote"], 20)
        shot("07-leave-apply")
        let apply = app.buttons["leave.submit"]
        eventually("Apply to be enabled") { apply.isEnabled }
        apply.tap()
        wait(app.descendants(matching: .any)["leave.request"].firstMatch)
        XCTAssertTrue(app.staticTexts["Pending"].firstMatch.exists)
        // Withdraw is a visible button on a pending request (it was a List swipe action) and asks
        // first. Keep the request: the manager test decides on it.
        let withdraw = app.buttons["leave.withdraw"].firstMatch
        XCTAssertTrue(withdraw.exists, "A pending request offers Withdraw")
        withdraw.tap()
        XCTAssertTrue(wait(app.alerts.buttons["Withdraw"]).exists)
        app.alerts.buttons["Keep it"].tap()
        XCTAssertTrue(app.staticTexts["Pending"].firstMatch.exists)

        // Claims: a receipt from the camera (stubbed on the simulator, which has no camera).
        let claimsUnderMore = openFromMore("more.claims", sidebar: "Claims")
        wait(app.buttons["claims.new"]).tap()
        wait(app.textFields["claim.merchant"]).tap()
        app.textFields["claim.merchant"].typeText("Kopi Kaki Cafe")
        app.textFields["claim.description"].tap()
        app.textFields["claim.description"].typeText("Team breakfast")
        app.textFields["claim.amount"].tap()
        app.textFields["claim.amount"].typeText("12.50")
        app.buttons["claim.camera"].tap()
        wait(app.buttons["camera.shutter"]).tap()
        wait(app.images["claim.receiptPreview"])
        shot("08-claim-with-receipt")
        let submit = app.buttons["claim.submit"]
        for _ in 0..<4 where !submit.isHittable { app.swipeUp() }
        submit.tap()
        let claimRow = wait(app.descendants(matching: .any)["claim.row"].firstMatch, 20)
        XCTAssertTrue(claimRow.label.contains("12 Singapore dollars 50 cents"), "Claim row reads: \(claimRow.label)")
        if claimsUnderMore { app.navigationBars.buttons.firstMatch.tap() }

        // Payslips: last month's released payslip, read from the server.
        tapTab("Pay")
        wait(element("payslip.row"), 20).tap()
        let net = wait(app.staticTexts["payslip.net"])
        XCTAssertTrue(net.label.contains("Singapore dollars"), "Net pay is read aloud as money: \(net.label)")
        shot("09-payslip")
        let pdf = app.buttons["payslip.pdf"]
        for _ in 0..<4 where !pdf.isHittable { app.swipeUp() }
        pdf.tap()
        wait(app.navigationBars["Payslip"], 20)
        app.navigationBars["Payslip"].buttons["Done"].tap()

        // Notifications inbox.
        tapTab("Inbox")
        XCTAssertTrue(app.buttons["notification.row"].firstMatch.waitForExistence(timeout: 10) || app.otherElements["state.empty"].exists)

        assertOnlyTalkedToTheTestServer()
        shot("10-settings")
    }

    func test2_ManagerRejectsWithCommentAndApproves() throws {
        connectAndSignIn(as: Self.manager)
        tapTab("Inbox")
        wait(app.buttons["approval.row"].firstMatch, 20)
        shot("11-approvals")
        let before = app.buttons.matching(identifier: "approval.row").count
        XCTAssertGreaterThanOrEqual(before, 2, "Expected Nurul's leave and claim plus the seeded requests")

        // The decision shows what is decided (the request's summary), not just its title.
        app.buttons["approval.row"].firstMatch.tap()
        wait(element("decision.details"), 20)
        shot("11b-decision-details")
        // Reject without a comment: the app asks for one first, as the web does.
        wait(app.buttons["decision.reject"]).tap()
        wait(app.staticTexts["decision.commentRequired"])
        shot("12-reject-needs-comment")
        app.textFields["decision.comment"].tap()
        app.textFields["decision.comment"].typeText("Please attach the receipt and resubmit.")
        app.buttons["decision.reject"].tap()
        eventually("the rejected task to leave the inbox") { app.buttons.matching(identifier: "approval.row").count == before - 1 }
        XCTAssertTrue(wait(element("approvals.notice")).label.hasPrefix("Rejected:"), "The list says what was done")

        // Approve the next one.
        app.buttons["approval.row"].firstMatch.tap()
        wait(app.buttons["decision.approve"]).tap()
        eventually("the approved task to leave the inbox") { app.buttons.matching(identifier: "approval.row").count == before - 2 }

        assertOnlyTalkedToTheTestServer()
    }

    func test3_SignOutRevokesTheDeviceSession() throws {
        connectAndSignIn(as: Self.employee)
        openFromMore("more.settings", sidebar: "Settings")
        wait(app.buttons["settings.signOut"]).tap()
        let confirm = app.sheets.buttons["Sign out"].exists ? app.sheets.buttons["Sign out"] : app.buttons["Sign out"].firstMatch
        wait(confirm).tap()
        wait(app.buttons["signin.start"])
        XCTAssertEqual(app.staticTexts["signin.orgName"].label, "Kampong Kopi Pte. Ltd.")
    }
}
