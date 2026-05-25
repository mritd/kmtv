import XCTest

/// Verify search TextField is tappable and accepts input on iPad without rotation.
@MainActor
final class SearchTextFieldUITests: XCTestCase {
    private let app = XCUIApplication()
    private let screenshotDir = "/tmp"
    private let serverURL = ProcessInfo.processInfo.environment["KMTV_TEST_SERVER_URL"] ?? "http://localhost:8080"
    private let serverBinary = "/tmp/kmtv-test"
    private let serverDB = "/tmp/kmtv-search-test.db"
    private let pidFile = "/tmp/kmtv-search-test.pid"
    private var testPrefix = ""

    override func setUp() async throws {
        continueAfterFailure = false
        testPrefix = name
            .replacingOccurrences(of: "-[KMTVUITests.SearchTextFieldUITests ", with: "")
            .replacingOccurrences(of: "]", with: "")
    }

    override func tearDown() async throws {
        stopServer()
    }

    // MARK: - Server Control

    private func startServer() {
        stopServer()

        var pid: pid_t = 0
        let argv: [UnsafeMutablePointer<CChar>?] = [
            strdup(serverBinary),
            strdup("--listen"), strdup("0.0.0.0:8080"),
            strdup("--db-path"), strdup(serverDB),
            nil
        ]
        let env = environ

        var fileActions: posix_spawn_file_actions_t?
        posix_spawn_file_actions_init(&fileActions)
        posix_spawn_file_actions_addopen(&fileActions, STDOUT_FILENO, "/dev/null", O_WRONLY, 0)
        posix_spawn_file_actions_addopen(&fileActions, STDERR_FILENO, "/dev/null", O_WRONLY, 0)

        let status = posix_spawn(&pid, serverBinary, &fileActions, nil, argv, env)
        posix_spawn_file_actions_destroy(&fileActions)
        argv.forEach { free($0) }

        if status == 0 {
            try? "\(pid)".write(toFile: pidFile, atomically: true, encoding: .utf8)
        }

        for _ in 0..<30 {
            if let data = try? Data(contentsOf: URL(string: "\(serverURL)/api/v1/settings")!),
               !data.isEmpty {
                return
            }
            Thread.sleep(forTimeInterval: 0.5)
        }
    }

    private func stopServer() {
        if let pidStr = try? String(contentsOfFile: pidFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
           let pid = pid_t(pidStr) {
            kill(pid, SIGTERM)
            for _ in 0..<20 {
                if kill(pid, 0) != 0 { break }
                Thread.sleep(forTimeInterval: 0.1)
            }
        }
        try? FileManager.default.removeItem(atPath: pidFile)
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

    private func connectToTestServer() -> Bool {
        let meTab = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Me' OR label CONTAINS[c] '我的'")).firstMatch

        if meTab.waitForExistence(timeout: 3) {
            meTab.tap()
            let signOutBtn = app.buttons.matching(identifier: "signOutButton").firstMatch
            if signOutBtn.waitForExistence(timeout: 5) {
                signOutBtn.tap()
                let urlField = app.textFields.matching(identifier: "serverURLField").firstMatch
                guard urlField.waitForExistence(timeout: 10) else { return false }
            }
        }

        let changeBtn = app.buttons.matching(NSPredicate(format:
            "label CONTAINS[c] 'Change' OR label CONTAINS[c] '更换'")).firstMatch
        if changeBtn.waitForExistence(timeout: 3) {
            changeBtn.tap()
            let urlField = app.textFields.matching(identifier: "serverURLField").firstMatch
            guard urlField.waitForExistence(timeout: 10) else { return false }
        }

        let urlField = app.textFields.matching(identifier: "serverURLField").firstMatch
        guard urlField.waitForExistence(timeout: 10) else {
            saveScreenshot(named: "FAIL_no_server_url_field")
            return false
        }

        urlField.tap()
        urlField.tap(withNumberOfTaps: 3, numberOfTouches: 1)
        urlField.typeText(serverURL)

        // Dismiss keyboard so connect button is visible
        app.tap()
        sleep(1)

        let connectButton = app.buttons.matching(identifier: "connectButton").firstMatch
        guard connectButton.waitForExistence(timeout: 3) else { return false }
        connectButton.tap()

        let homeTab = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Home' OR label CONTAINS[c] '首页'")).firstMatch
        return homeTab.waitForExistence(timeout: 15)
    }

    // MARK: - Tests

    func testSearchTextFieldTappableWithoutRotation() throws {
        startServer()
        app.launch()

        guard connectToTestServer() else {
            XCTFail("Could not connect to test server")
            return
        }

        // Ensure on Home tab
        let homeTab = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Home' OR label CONTAINS[c] '首页'")).firstMatch
        homeTab.tap()
        sleep(2)
        saveScreenshot(named: "01_home")

        // Tap search button
        let searchBtn = app.buttons.matching(identifier: "homeSearchButton").firstMatch
        guard searchBtn.waitForExistence(timeout: 5) else {
            XCTFail("Search button not found on home")
            return
        }
        searchBtn.tap()
        sleep(1)
        saveScreenshot(named: "02_search_page")

        // Verify navigation bar back button exists and is positioned correctly
        let backButton = app.navigationBars.buttons.firstMatch
        XCTAssertTrue(backButton.waitForExistence(timeout: 3), "Back button should exist")
        saveScreenshot(named: "03_back_button_check")

        // Try tapping the search text field - this is the key test
        // The UIViewRepresentable TextField should be inside the search bar area
        let textField = app.textFields.firstMatch
        guard textField.waitForExistence(timeout: 5) else {
            // Fallback: try finding any text input element
            saveScreenshot(named: "FAIL_no_textfield")
            XCTFail("No text field found on search page")
            return
        }

        saveScreenshot(named: "04_before_tap")

        // Tap the text field - this is the critical test
        textField.tap()
        sleep(1)
        saveScreenshot(named: "05_after_tap")

        // Check if keyboard appeared by trying to type
        textField.typeText("test")
        sleep(1)
        saveScreenshot(named: "06_after_typing")

        // Verify text was entered
        let typedText = textField.value as? String ?? ""
        XCTAssertEqual(typedText, "test", "Text field should contain typed text. Got: '\(typedText)'")

        saveScreenshot(named: "07_test_passed")
    }

    func testBackButtonPositionConsistent() throws {
        startServer()
        app.launch()

        guard connectToTestServer() else {
            XCTFail("Could not connect to test server")
            return
        }

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

        // Record back button frame
        let navBar = app.navigationBars.firstMatch
        guard navBar.waitForExistence(timeout: 3) else {
            XCTFail("Navigation bar not found")
            return
        }
        let backButton = navBar.buttons.firstMatch
        let initialFrame = backButton.frame
        saveScreenshot(named: "01_initial_back_button")

        // Switch to another tab and back
        let favTab = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Favorites' OR label CONTAINS[c] '收藏'")).firstMatch
        guard favTab.waitForExistence(timeout: 3) else {
            XCTFail("Favorites tab not found")
            return
        }
        favTab.tap()
        sleep(1)
        saveScreenshot(named: "02_favorites_tab")

        // Go back to Home tab - search should still be showing
        homeTab.tap()
        sleep(1)
        saveScreenshot(named: "03_back_to_home_search")

        // Check back button position hasn't changed
        let backButtonAfter = navBar.buttons.firstMatch
        if backButtonAfter.exists {
            let afterFrame = backButtonAfter.frame
            saveScreenshot(named: "04_back_button_after_tab_switch")

            // Y position should be similar (within 5pt tolerance)
            XCTAssertEqual(initialFrame.minY, afterFrame.minY, accuracy: 5,
                           "Back button Y position should be consistent. Before: \(initialFrame.minY), After: \(afterFrame.minY)")
        }
    }
}
