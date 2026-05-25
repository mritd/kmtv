import XCTest

/// UI tests for home page: loading, refresh, and server-down sign-out flow.
/// Server is started/stopped by the test itself via shell commands.
@MainActor
final class HomeUITests: XCTestCase {
    private let app = XCUIApplication()
    private let screenshotDir = "/tmp"
    private let serverURL = ProcessInfo.processInfo.environment["KMTV_TEST_SERVER_URL"] ?? "http://localhost:8080"
    private let serverBinary = "/tmp/kmtv-test"
    private let serverDB = "/tmp/kmtv-test.db"
    private let pidFile = "/tmp/kmtv-test.pid"
    private var testPrefix = ""

    override func setUp() async throws {
        continueAfterFailure = false
        testPrefix = name
            .replacingOccurrences(of: "-[KMTVUITests.HomeUITests ", with: "")
            .replacingOccurrences(of: "]", with: "")
    }

    override func tearDown() async throws {
        stopServer()
    }

    // MARK: - Server Control (POSIX fork/exec)

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

        // Wait for server to be ready
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

    /// Sign out if connected, then connect to the test server.
    private func connectToTestServer() -> Bool {
        let meTab = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Me' OR label CONTAINS[c] '我的'")).firstMatch

        // If already connected, sign out first
        if meTab.waitForExistence(timeout: 3) {
            meTab.tap()
            let signOutBtn = app.buttons.matching(identifier: "signOutButton").firstMatch
            if signOutBtn.waitForExistence(timeout: 5) {
                signOutBtn.tap()
                let urlField = app.textFields.matching(identifier: "serverURLField").firstMatch
                guard urlField.waitForExistence(timeout: 10) else { return false }
            }
        }

        // If on connection error page, tap "Change Server"
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

        let connectButton = app.buttons.matching(identifier: "connectButton").firstMatch
        guard connectButton.waitForExistence(timeout: 3) else { return false }
        connectButton.tap()

        let homeTab = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Home' OR label CONTAINS[c] '首页'")).firstMatch
        return homeTab.waitForExistence(timeout: 15)
    }

    // MARK: - Tests (server online)

    func testHomeLoadsWithoutError() throws {
        startServer()
        app.launch()

        guard connectToTestServer() else {
            XCTFail("Could not connect to test server")
            return
        }

        let homeTab = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Home' OR label CONTAINS[c] '首页'")).firstMatch
        homeTab.tap()

        let kmtvTitle = app.staticTexts["KMTV"]
        XCTAssertTrue(kmtvTitle.waitForExistence(timeout: 10), "KMTV title should appear")
        saveScreenshot(named: "01_home_loaded")

        // Wait for any transient toasts to auto-dismiss before checking
        sleep(6)
        let toast = app.descendants(matching: .any).matching(identifier: "toastMessage").firstMatch
        XCTAssertFalse(toast.isHittable, "No persistent toast should remain after home load")
        saveScreenshot(named: "02_no_error")
    }

    func testHomeRefreshWithoutError() throws {
        startServer()
        app.launch()

        guard connectToTestServer() else {
            XCTFail("Could not connect to test server")
            return
        }

        let homeTab = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Home' OR label CONTAINS[c] '首页'")).firstMatch
        homeTab.tap()

        let kmtvTitle = app.staticTexts["KMTV"]
        guard kmtvTitle.waitForExistence(timeout: 10) else {
            XCTFail("Home page didn't load")
            return
        }
        saveScreenshot(named: "01_before_refresh")

        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9))
        start.press(forDuration: 0.1, thenDragTo: end)

        sleep(3)
        saveScreenshot(named: "02_after_refresh")

        let toast = app.descendants(matching: .any).matching(identifier: "toastMessage").firstMatch
        XCTAssertFalse(toast.exists, "No toast should appear after refresh")
        saveScreenshot(named: "03_no_error_after_refresh")
    }

    // MARK: - Tests (server goes down after connecting)

    func testChangeServerFromProfileWhenServerDown() throws {
        startServer()
        app.launch()

        guard connectToTestServer() else {
            XCTFail("Could not connect to test server")
            return
        }

        // Kill the server
        stopServer()
        sleep(1)

        // Go to profile tab
        let meTab = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Me' OR label CONTAINS[c] '我的'")).firstMatch
        meTab.tap()
        saveScreenshot(named: "01_profile_server_down")

        // Tap sign out - should work even with server down (3s timeout)
        let signOutBtn = app.buttons.matching(identifier: "signOutButton").firstMatch
        guard signOutBtn.waitForExistence(timeout: 5) else {
            XCTFail("Sign out button not found")
            return
        }
        signOutBtn.tap()
        saveScreenshot(named: "02_after_signout")

        // Should navigate to server setup (not get stuck)
        let urlField = app.textFields.matching(identifier: "serverURLField").firstMatch
        XCTAssertTrue(urlField.waitForExistence(timeout: 10),
                      "Should navigate to server setup after sign out when server is down")
        saveScreenshot(named: "03_server_setup_visible")
    }
}
