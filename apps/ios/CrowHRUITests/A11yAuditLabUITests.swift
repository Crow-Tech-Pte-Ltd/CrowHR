import XCTest

/// Task 3.7: Xcode's accessibility audit reports Dynamic Type "partially unsupported" (and "text
/// clipped") on app text in SwiftUI `List` and `Form` rows, but not on the same rows in a
/// `ScrollView`. `A11yAuditLabView` (DEBUG, `-uitest-a11y-lab`) shows identical rows three ways.
/// Each is audited five times at the largest accessibility size and at the default size. No server.
///
/// - "Scroll" is built from the row pieces the app's screens use (`RowsScreen`, `RowGroup`,
///   `ChoiceRow`): any finding there fails the test, a fast regression check for those pieces.
/// - "List" and "Form" are the 1.0.0 containers. Their findings are only printed (`LAB <variant>
///   <size> <run>: ...` and a `LAB SUMMARY` line), to show whether a later Xcode or iOS still
///   flags them before anyone moves a screen back to `List` or `Form`.
final class A11yAuditLabUITests: XCTestCase {
    func testAuditSameRowsBuiltThreeWays() throws {
        var scrollFindings: [String] = []
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
                        let line = "LAB \(variant) \(size) \(run): \(type) \(issue.compactDescription) — '\(label)'"
                        print(line)
                        flagged.add(line)
                        return true
                    }
                }
                print("LAB SUMMARY \(variant) \(size): \(flagged.count) findings in 5 audits")
                if variant == "Scroll" { scrollFindings += flagged.lines }
            }
            app.terminate()
        }
        XCTAssertTrue(scrollFindings.isEmpty, "The app's row pieces must audit clean:\n" + scrollFindings.joined(separator: "\n"))
    }
}

/// Collects audit findings from the audit's issue handler (captured as a constant).
private final class Tally: @unchecked Sendable {
    private let lock = NSLock()
    private var found: [String] = []
    var count: Int { lock.withLock { found.count } }
    var lines: [String] { lock.withLock { found } }
    func add(_ line: String) { lock.withLock { found.append(line) } }
}
