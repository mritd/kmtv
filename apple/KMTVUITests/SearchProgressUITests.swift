import XCTest

/// Verify SSE search progress text is displayed during search.
@MainActor
final class SearchProgressUITests: XCTestCase {
    private let app = XCUIApplication()
    private let screenshotDir = "/tmp"
    private let serverURL = "http://10.10.10.222:8080"
    private var testPrefix = ""

    override func setUp() async throws {
        continueAfterFailure = false
        testPrefix = name
            .replacingOccurrences(of: "-[KMTVUITests.SearchProgressUITests ", with: "")
            .replacingOccurrences(of: "]", with: "")
    }

    // MARK: - Helpers

    private func saveScreenshot(named name: String) {
        let screenshot = app.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.lifetime = .keepAlways
        attachment.name = "\(testPrefix)_\(name)"
        add(attachment)

        let safeName = "\(testPrefix)_\(name)"
            .replacingOccurrences(of: "[^a-zA-Z0-9_-]", with: "_", options: .regularExpression)
        let path = "\(screenshotDir)/\(safeName).png"
        try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: path))
    }

    private func connectToServer() -> Bool {
        // If already connected, go to Home
        let homeTab = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Home' OR label CONTAINS[c] '首页'")).firstMatch
        if homeTab.waitForExistence(timeout: 3) {
            return true
        }

        // Sign out if needed
        let meTab = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Me' OR label CONTAINS[c] '我的'")).firstMatch
        if meTab.waitForExistence(timeout: 3) {
            meTab.tap()
            let signOutBtn = app.buttons.matching(identifier: "signOutButton").firstMatch
            if signOutBtn.waitForExistence(timeout: 5) {
                signOutBtn.tap()
            }
        }

        // Change server if needed
        let changeBtn = app.buttons.matching(NSPredicate(format:
            "label CONTAINS[c] 'Change' OR label CONTAINS[c] '更换'")).firstMatch
        if changeBtn.waitForExistence(timeout: 3) {
            changeBtn.tap()
        }

        // Enter server URL
        let urlField = app.textFields.matching(identifier: "serverURLField").firstMatch
        guard urlField.waitForExistence(timeout: 10) else {
            saveScreenshot(named: "FAIL_no_server_url_field")
            return false
        }
        urlField.tap()
        urlField.tap(withNumberOfTaps: 3, numberOfTouches: 1)
        urlField.typeText(serverURL)

        // Dismiss keyboard
        app.tap()
        sleep(1)

        let connectButton = app.buttons.matching(identifier: "connectButton").firstMatch
        guard connectButton.waitForExistence(timeout: 3) else { return false }
        connectButton.tap()

        return homeTab.waitForExistence(timeout: 15)
    }

    // MARK: - Tests

    func testSearchProgressDisplayed() throws {
        app.launch()

        guard connectToServer() else {
            XCTFail("Could not connect to server")
            return
        }

        // Go to Home
        let homeTab = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Home' OR label CONTAINS[c] '首页'")).firstMatch
        homeTab.tap()
        sleep(2)

        // Navigate to search
        let searchBtn = app.buttons.matching(identifier: "homeSearchButton").firstMatch
        guard searchBtn.waitForExistence(timeout: 5) else {
            XCTFail("Search button not found")
            return
        }
        searchBtn.tap()
        sleep(1)

        // Type search query and submit
        let textField = app.textFields.firstMatch
        guard textField.waitForExistence(timeout: 5) else {
            XCTFail("Search text field not found")
            return
        }
        textField.tap()
        textField.typeText("庆余年\n")

        // Check for progress element - it should appear briefly during search
        let progressView = app.staticTexts.matching(NSPredicate(format:
            "label CONTAINS[c] 'Searching' OR label CONTAINS[c] '搜索可用源' OR label CONTAINS[c] 'Probing' OR label CONTAINS[c] 'CDN'")).firstMatch

        // Progress text should appear within 2 seconds of submitting search
        let progressAppeared = progressView.waitForExistence(timeout: 5)
        saveScreenshot(named: "01_during_search")

        // Wait for search to complete and results to load
        let resultItem = app.buttons.matching(identifier: "searchResult").firstMatch
        let gotResults = resultItem.waitForExistence(timeout: 30)
        saveScreenshot(named: "02_search_results")

        // Assert progress was shown
        XCTAssertTrue(progressAppeared, "Search progress text should appear during search")

        // Assert results were loaded (search worked end-to-end)
        XCTAssertTrue(gotResults, "Search results should appear after search completes")
    }
}
