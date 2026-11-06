import XCTest

/// Placeholder until the seeded-server journey (task 3.5) is written.
final class EssJourneyUITests: XCTestCase {
    func testLaunchShowsConnect() {
        let app = XCUIApplication()
        app.launchArguments = ["-uitest", "-uitest-reset"]
        app.launch()
        XCTAssertTrue(app.textFields["connect.address"].waitForExistence(timeout: 10))
    }
}
