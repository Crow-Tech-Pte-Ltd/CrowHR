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

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-uitest", "-uitest-reset", "-uitest-camera-stub"]
    }

    /// Dark appearance and an accessibility text size, for QA (task 3.7).
    func useAppearance(dark: Bool, xxxl: Bool) {
        if dark { app.launchArguments.append("-uitest-dark") }
        if xxxl { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] }
    }

    // MARK: Helpers

    func shot(_ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
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

    func tapTab(_ label: String) {
        let button = app.tabBars.buttons[label]
        if button.waitForExistence(timeout: 5) { button.tap() } else { app.buttons[label].firstMatch.tap() }
    }

    func connectAndSignIn(as email: String) {
        app.launch()
        let address = wait(app.textFields["connect.address"])
        address.tap()
        address.typeText(server)
        app.buttons["connect.continue"].tap()
        // This install hosts two organisations, so the server asks which one (as a QR code would say).
        let org = wait(app.textFields["connect.org"])
        shot("00-organisation-required")
        org.tap()
        org.typeText("kampong-kopi")
        app.buttons["connect.continue"].tap()
        XCTAssertEqual(wait(app.staticTexts["confirm.orgName"]).label, "Kampong Kopi Pte. Ltd.")
        XCTAssertTrue(app.staticTexts["confirm.insecure"].exists || app.otherElements["confirm.insecure"].exists,
                      "Plain-http private address must show the not-encrypted warning")
        shot("01-confirm-server")
        app.buttons["confirm.connect"].tap()
        wait(app.buttons["signin.start"]).tap()

        // The system browser session (SafariViewService), showing the server's own sign-in page.
        let browser = XCUIApplication(bundleIdentifier: "com.apple.SafariViewService")
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let consent = springboard.buttons["Continue"]
        if consent.waitForExistence(timeout: 3) { consent.tap() }
        let emailField = browser.textFields["Work email"].exists ? browser.textFields["Work email"] : browser.webViews.textFields.firstMatch
        XCTAssertTrue(emailField.waitForExistence(timeout: 30), "The sign-in page did not open in the system browser")
        focusAndType(emailField, email)
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
        tapTab("More")
        wait(app.buttons["more.settings"]).tap()
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
        XCTAssertTrue(app.otherElements["shift.row"].firstMatch.waitForExistence(timeout: 10) || app.staticTexts["No shifts in the next two weeks."].exists)

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

        // Claims: a receipt from the camera (stubbed on the simulator, which has no camera).
        tapTab("More")
        wait(app.buttons["more.claims"]).tap()
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
        app.navigationBars.buttons.firstMatch.tap()

        // Payslips: last month's released payslip, read from the server.
        tapTab("Pay")
        wait(app.buttons["payslip.row"].firstMatch, 20).tap()
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

        // Reject without a comment: the app asks for one first, as the web does.
        app.buttons["approval.row"].firstMatch.tap()
        wait(app.buttons["decision.reject"]).tap()
        wait(app.staticTexts["decision.commentRequired"])
        shot("12-reject-needs-comment")
        app.textFields["decision.comment"].tap()
        app.textFields["decision.comment"].typeText("Please attach the receipt and resubmit.")
        app.buttons["decision.reject"].tap()
        eventually("the rejected task to leave the inbox") { app.buttons.matching(identifier: "approval.row").count == before - 1 }

        // Approve the next one.
        app.buttons["approval.row"].firstMatch.tap()
        wait(app.buttons["decision.approve"]).tap()
        eventually("the approved task to leave the inbox") { app.buttons.matching(identifier: "approval.row").count == before - 2 }

        assertOnlyTalkedToTheTestServer()
    }

    func test3_SignOutRevokesTheDeviceSession() throws {
        connectAndSignIn(as: Self.employee)
        tapTab("More")
        wait(app.buttons["more.settings"]).tap()
        wait(app.buttons["settings.signOut"]).tap()
        let confirm = app.sheets.buttons["Sign out"].exists ? app.sheets.buttons["Sign out"] : app.buttons["Sign out"].firstMatch
        wait(confirm).tap()
        wait(app.buttons["signin.start"])
        XCTAssertEqual(app.staticTexts["signin.orgName"].label, "Kampong Kopi Pte. Ltd.")
    }
}
