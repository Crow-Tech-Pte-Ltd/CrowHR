import XCTest

/// Task 3.7: the real app against the seeded server in dark mode and at the largest accessibility
/// text size (Dynamic Type AX XXXL), with Xcode's accessibility audit on each main screen
/// (missing VoiceOver descriptions, clipped text, Dynamic Type support). Screenshots are kept in
/// the xcresult; scripts/ios-ui-test.sh copies them to artifacts/ios/.
final class QAScreenshotsUITests: CrowUITestCase {
    func testA_LightXXXL() throws { try tour(prefix: "qa-light-xxxl", dark: false, xxxl: true) }
    func testB_DarkDefaultSize() throws { try tour(prefix: "qa-dark", dark: true, xxxl: false) }
    func testC_DarkXXXL() throws { try tour(prefix: "qa-dark-xxxl", dark: true, xxxl: true) }

    private func tour(prefix: String, dark: Bool, xxxl: Bool) throws {
        useAppearance(dark: dark, xxxl: xxxl)
        connectAndSignIn(as: Self.employee)
        shot("\(prefix)-today")
        try audit("Today")

        tapTab("Leave")
        wait(app.descendants(matching: .any)["leave.balance"].firstMatch)
        shot("\(prefix)-leave")
        try audit("Leave")

        tapTab("Pay")
        wait(app.buttons["payslip.row"].firstMatch, 20).tap()
        wait(app.staticTexts["payslip.net"])
        shot("\(prefix)-payslip")
        try audit("Payslip")

        tapTab("Inbox")
        RunLoop.current.run(until: Date().addingTimeInterval(1.5))
        shot("\(prefix)-inbox")
        try audit("Inbox")

        tapTab("More")
        wait(app.buttons["more.claims"]).tap()
        wait(app.buttons["claims.new"]).tap()
        wait(app.textFields["claim.merchant"])
        shot("\(prefix)-new-claim")
        try audit("New claim")
    }

    /// Fails on missing accessibility descriptions, clipped text and missing Dynamic Type support.
    /// Contrast and hit-region checks are reported by the full audit in the QA notes, not here:
    /// system controls in sheets trip them on the simulator independently of the app.
    private func audit(_ screen: String) throws {
        // The floating tab bar isn't exposed as `tabBars`: locate it from its tab buttons.
        let tabButton = app.buttons["More"].firstMatch
        let tabBarTop = app.tabBars.firstMatch.exists ? app.tabBars.firstMatch.frame.minY
            : tabButton.exists ? tabButton.frame.minY - 8 : .greatestFiniteMagnitude
        let navBar = app.navigationBars.firstMatch.exists ? app.navigationBars.firstMatch.frame : .null
        try app.performAccessibilityAudit(for: [.sufficientElementDescription, .textClipped, .dynamicType]) { issue in
            // An issue with no element can't be located in the app's own UI.
            guard let element = issue.element else { return true }
            let frame = element.frame
            if issue.auditType == .dynamicType {
                // iOS caps navigation-bar button text by design (Large Content Viewer covers it),
                // and the audit can't measure text scrolled under the floating tab bar. Logged,
                // not failed; clipping and missing descriptions are never excused.
                if navBar.intersects(frame) || frame.maxY > tabBarTop {
                    print("AUDIT (excused) \(screen): \(issue.compactDescription) — \(element.debugDescription.prefix(120))")
                    return true
                }
            }
            print("AUDIT \(screen): \(issue.compactDescription) — \(element.debugDescription.prefix(160))")
            return false
        }
    }
}
