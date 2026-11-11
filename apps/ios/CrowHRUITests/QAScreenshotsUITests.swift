import XCTest

/// Task 3.7: the real app against the seeded server in dark mode and at the largest accessibility
/// text size (Dynamic Type AX XXXL), with Xcode's accessibility audit on every screen an employee
/// reaches, from connecting to the server to Settings (and, as a manager, the approvals inbox, the
/// decision sheet and notifications): missing VoiceOver descriptions, clipped text, Dynamic Type
/// support. Each tour visits every screen and then fails
/// with all the findings, so one finding doesn't hide the rest. Every finding is printed as
/// `AUDIT FAIL <screen>: ...`, each screen's count as `AUDIT SCREEN <tour> <screen>: ...`, and the
/// tour's total as `AUDIT TOTAL <tour>: ...`. Screenshots are kept in the xcresult;
/// scripts/ios-ui-test.sh copies them to artifacts/ios/.
final class QAScreenshotsUITests: CrowUITestCase {
    /// Also applies for leave, so the later tours audit Leave with a pending request (and its
    /// Withdraw button) and the manager sees it in approvals.
    func testA_LightXXXL() throws { try employeeTour(prefix: "qa-light-xxxl", dark: false, xxxl: true, applyForLeave: true) }
    func testB_DarkDefaultSize() throws { try employeeTour(prefix: "qa-dark", dark: true, xxxl: false) }
    func testC_DarkXXXL() throws { try employeeTour(prefix: "qa-dark-xxxl", dark: true, xxxl: true) }
    func testD_ManagerLightXXXL() throws { try managerTour(prefix: "qa-manager-xxxl", dark: false, xxxl: true) }

    private var tourName = ""
    private var findings: [String] = []
    private var excused = 0
    private var screens = 0

    private func employeeTour(prefix: String, dark: Bool, xxxl: Bool, applyForLeave: Bool = false) throws {
        begin(prefix, dark: dark, xxxl: xxxl)
        connectAndSignIn(as: Self.employee)
        try check("Today", "\(prefix)-today")

        tapTab("Leave")
        wait(app.descendants(matching: .any)["leave.balance"].firstMatch)
        try check("Leave", "\(prefix)-leave")
        app.buttons["leave.apply"].tap()
        wait(app.staticTexts["leave.quote"], 20)
        try check("New leave", "\(prefix)-leave-apply")
        let apply = app.buttons["leave.submit"]
        // In a full UI run EssJourneyUITests has already applied for that day: Apply stays disabled
        // (the quote reports the overlap) and that pending request serves the later tours instead.
        if applyForLeave && apply.isEnabled {
            apply.tap()
            wait(app.descendants(matching: .any)["leave.request"].firstMatch)
            wait(app.buttons["leave.withdraw"])
            try check("Leave, pending request", "\(prefix)-leave-request")
        } else {
            app.navigationBars["New leave"].buttons["Cancel"].tap()
            wait(app.buttons["leave.apply"])
        }

        tapTab("Pay")
        let payslip = wait(app.buttons["payslip.row"].firstMatch, 20)
        try check("Payslips", "\(prefix)-payslips")
        payslip.tap()
        wait(app.staticTexts["payslip.net"])
        try check("Payslip", "\(prefix)-payslip")

        tapTab("Inbox")
        waitUntilLoaded()
        try check("Inbox", "\(prefix)-inbox")

        // On a phone (and an iPad at compact widths) through More; on an iPad at regular width
        // Claims, Schedule, Profile and Settings are tabs of their own (no More screen).
        let underMore = !isPad || moreTab.waitForExistence(timeout: 2)
        if underMore {
            tapTab("More")
            wait(app.buttons["more.claims"])
            try check("More", "\(prefix)-more")
            app.buttons["more.claims"].tap()
        } else {
            tapTab("Claims")
        }
        wait(app.buttons["claims.new"])
        waitUntilLoaded()
        try check("Claims", "\(prefix)-claims")
        app.buttons["claims.new"].tap()
        wait(app.textFields["claim.merchant"])
        try check("New claim", "\(prefix)-new-claim")
        if xxxl {
            // At accessibility sizes the claim type opens a list of its own.
            app.buttons["claim.type"].tap()
            wait(app.buttons["choice.option"].firstMatch)
            try check("Claim type", "\(prefix)-claim-type")
            let chosen = app.buttons.matching(NSPredicate(format: "identifier == 'choice.option' AND selected == true")).firstMatch
            (chosen.exists ? chosen : app.buttons["choice.option"].firstMatch).tap()
            wait(app.textFields["claim.merchant"])
        }
        app.navigationBars["New claim"].buttons["Cancel"].tap()
        wait(app.buttons["claims.new"])
        if underMore {
            app.navigationBars.buttons.firstMatch.tap()
            wait(app.buttons["more.profile"])
            if app.buttons["more.schedule"].exists {
                app.buttons["more.schedule"].tap()
                waitUntilLoaded()
                try check("My schedule", "\(prefix)-schedule")
                app.navigationBars.buttons.firstMatch.tap()
            }
            wait(app.buttons["more.profile"]).tap()
            waitUntilLoaded()
            try check("My profile", "\(prefix)-profile")
            app.navigationBars.buttons.firstMatch.tap()
            wait(app.buttons["more.settings"]).tap()
        } else {
            // In portrait these three are in the sidebar only: `tapTab` opens it.
            tapTab("Schedule")
            waitUntilLoaded()
            try check("My schedule", "\(prefix)-schedule")
            tapTab("Profile")
            waitUntilLoaded()
            try check("My profile", "\(prefix)-profile")
            tapTab("Settings")
        }
        wait(app.buttons["settings.signOut"])
        try check("Settings", "\(prefix)-settings")
        app.buttons["Font licences"].tap()
        wait(app.navigationBars["Font licences"])
        try check("Font licences", "\(prefix)-licences")

        finish()
    }

    private func managerTour(prefix: String, dark: Bool, xxxl: Bool) throws {
        begin(prefix, dark: dark, xxxl: xxxl)
        connectAndSignIn(as: Self.manager)
        tapTab("Inbox")
        wait(app.buttons["approval.row"].firstMatch, 20)
        try check("Approvals", "\(prefix)-approvals")
        app.buttons["approval.row"].firstMatch.tap()
        wait(app.buttons["decision.approve"])
        try check("Decision", "\(prefix)-decision")
        app.navigationBars["Decision"].buttons["Cancel"].tap()
        wait(app.buttons["approval.row"].firstMatch)
        app.buttons["Notifications"].firstMatch.tap()
        waitUntilLoaded()
        try check("Notifications", "\(prefix)-notifications")
        finish()
    }

    // MARK: Audit

    private func begin(_ tour: String, dark: Bool, xxxl: Bool) {
        tourName = tour
        useAppearance(dark: dark, xxxl: xxxl)
        // The connect, confirm and sign-in screens on the way in.
        checkScreen = { [unowned self] screen, slug in
            do { try check(screen, "\(tour)-\(slug)") } catch { XCTFail("The audit of \(screen) didn't run: \(error)") }
        }
    }

    /// Printed even when a tour stops early (a missing element), so the log shows how far it got.
    override func tearDown() {
        print("AUDIT TOTAL \(tourName): \(findings.count) findings, \(excused) excused, \(screens) screens audited")
        super.tearDown()
    }

    private func finish() {
        XCTAssertTrue(findings.isEmpty, "\(findings.count) accessibility audit findings in \(tourName):\n" + findings.joined(separator: "\n"))
    }

    /// Lets the screen settle after its data loads (no `state.loading` left).
    private func waitUntilLoaded() {
        RunLoop.current.run(until: Date().addingTimeInterval(0.8))
        let loading = app.descendants(matching: .any)["state.loading"]
        eventually("the screen to load") { !loading.exists }
        RunLoop.current.run(until: Date().addingTimeInterval(0.5))
    }

    private func check(_ screen: String, _ shotName: String) throws {
        shot(shotName)
        try audit(screen)
    }

    /// Records missing accessibility descriptions, clipped text and missing Dynamic Type support.
    /// Contrast and hit-region checks are reported by the full audit in the QA notes, not here:
    /// system controls in sheets trip them on the simulator independently of the app.
    private func audit(_ screen: String) throws {
        // The floating tab bar isn't exposed as `tabBars`: locate it from its tab buttons.
        let tabButton = app.buttons["More"].firstMatch
        let tabBarTop = app.tabBars.firstMatch.exists ? app.tabBars.firstMatch.frame.minY
            : tabButton.exists ? tabButton.frame.minY - 8 : .greatestFiniteMagnitude
        // Every navigation bar on screen: a sheet has its own above the screen behind it. On an
        // iPad in portrait iPadOS's floating tab bar sits at the top, a system bar like them.
        let topTabs = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'tab.' OR identifier == 'ToggleSideBar'"))
            .allElementsBoundByIndex.map(\.frame).filter { $0.minY < 120 && $0.width > 1 }
        let navBars = app.navigationBars.allElementsBoundByIndex.map { $0.frame } + topTabs
        let log = AuditLog()
        try app.performAccessibilityAudit(for: [.sufficientElementDescription, .textClipped, .dynamicType]) { issue in
            let type = switch issue.auditType {
            case .dynamicType: "dynamicType"
            case .textClipped: "textClipped"
            case .sufficientElementDescription: "description"
            default: "other"
            }
            // An issue without an element can't be located, so it is not excused either.
            guard let element = issue.element else {
                log.fail("\(screen): \(type) \(issue.compactDescription) — (no element) \(issue.detailedDescription)")
                return true
            }
            let frame = element.frame
            // iOS caps navigation-bar and tab-bar button text by design (Large Content Viewer
            // covers it), and the audit can't measure text scrolled under the floating tab bar.
            // Logged, not failed;
            // clipping and missing descriptions are never excused.
            if issue.auditType == .dynamicType && (navBars.contains { $0.intersects(frame) } || frame.maxY > tabBarTop) {
                log.excuse("\(screen): \(type) \(issue.compactDescription) — \(element.debugDescription.prefix(120))")
                return true
            }
            log.fail("\(screen): \(type) \(issue.compactDescription) — \(element.debugDescription.prefix(160)) \(issue.detailedDescription)")
            return true
        }
        for line in log.excusedLines { print("AUDIT (excused) \(line)") }
        for line in log.failures { print("AUDIT FAIL \(line)") }
        print("AUDIT SCREEN \(tourName) \(screen): \(log.failures.count) findings, \(log.excusedLines.count) excused")
        findings += log.failures
        excused += log.excusedLines.count
        screens += 1
    }
}

/// Audit issues gathered by the audit's issue handler (captured as a constant).
private final class AuditLog: @unchecked Sendable {
    private let lock = NSLock()
    private var failed: [String] = []
    private var excusedList: [String] = []
    var failures: [String] { lock.withLock { failed } }
    var excusedLines: [String] { lock.withLock { excusedList } }
    func fail(_ line: String) { lock.withLock { failed.append(line) } }
    func excuse(_ line: String) { lock.withLock { excusedList.append(line) } }
}
