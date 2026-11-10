import XCTest

/// Task 3.7 investigation: is Xcode's "Dynamic Type font sizes are partially unsupported" on app
/// text tied to how the row is built? `A11yAuditLabView` (DEBUG, `-uitest-a11y-lab`) shows the
/// same app rows in a `List`, a `Form` and a `ScrollView`. Each is audited five times at the
/// largest accessibility size and at the default size. Nothing here fails on audit findings: every
/// finding is printed as `LAB <variant> <size> <run>: <label>` for the QA notes, followed by a
/// `LAB SUMMARY` line per variant and size. No server needed.
final class A11yAuditLabUITests: XCTestCase {
    func testAuditSameRowsBuiltThreeWays() throws {
        for xxxl in [true, false] {
            let app = XCUIApplication()
            app.launchArguments = ["-uitest", "-uitest-a11y-lab"]
            if xxxl { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] }
            app.launch()
            let size = xxxl ? "xxxl" : "default"
            for variant in ["List", "Form", "Scroll"] {
                let tab = app.tabBars.buttons[variant].exists ? app.tabBars.buttons[variant] : app.buttons[variant].firstMatch
                XCTAssertTrue(tab.waitForExistence(timeout: 10))
                tab.tap()
                RunLoop.current.run(until: Date().addingTimeInterval(1.0))
                let flagged = Tally()
                for run in 1...5 {
                    try app.performAccessibilityAudit(for: [.dynamicType, .textClipped]) { issue in
                        let label = issue.element?.label ?? "(no element)"
                        let type = issue.auditType == .dynamicType ? "dynamicType" : "textClipped"
                        print("LAB \(variant) \(size) \(run): \(type) \(issue.compactDescription) — '\(label)'")
                        flagged.add()
                        return true
                    }
                }
                print("LAB SUMMARY \(variant) \(size): \(flagged.count) findings in 5 audits")
            }
            app.terminate()
        }
    }
}

/// Counts audit findings from the audit's issue handler (captured as a constant).
private final class Tally: @unchecked Sendable {
    private let lock = NSLock()
    private var n = 0
    var count: Int { lock.withLock { n } }
    func add() { lock.withLock { n += 1 } }
}
