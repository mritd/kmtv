import XCTest

/// UI tests for the toast error display system.
/// Tests toast appearance, auto-dismiss, and startup resilience with server down.
@MainActor
final class ToastUITests: XCTestCase {
    private let app = XCUIApplication()
    private let screenshotDir = "/tmp"
    private let serverURL = ProcessInfo.processInfo.environment["KMTV_TEST_SERVER_URL"] ?? "http://localhost:8080"
    private let serverBinary = "/tmp/kmtv-test"
    private let serverDB = "/tmp/kmtv-test.db"
    private let pidFile = "/tmp/kmtv-test.pid"

    override func setUp() async throws {
        continueAfterFailure = false
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
        attachment.name = "toast_\(name)"
        add(attachment)
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
        guard urlField.waitForExistence(timeout: 10) else { return false }

        urlField.tap()
        urlField.tap(withNumberOfTaps: 3, numberOfTouches: 1)
        urlField.typeText(serverURL)

        let connectButton = app.buttons.matching(identifier: "connectButton").firstMatch
        guard connectButton.waitForExistence(timeout: 3) else { return false }
        connectButton.tap()

        let homeTab = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Home' OR label CONTAINS[c] '首页'")).firstMatch
        return homeTab.waitForExistence(timeout: 15)
    }

    // MARK: - Tests

    /// Toast appears on network error and auto-dismisses after timeout.
    func testToastAppearAndAutoDismiss() throws {
        startServer()
        app.launch()

        guard connectToTestServer() else {
            XCTFail("Could not connect to test server")
            return
        }

        let kmtvTitle = app.staticTexts["KMTV"]
        guard kmtvTitle.waitForExistence(timeout: 10) else {
            XCTFail("Home page didn't load")
            return
        }

        // Stop server to cause network errors
        stopServer()
        sleep(1)

        // Trigger error via search
        let searchBtn = app.buttons.matching(identifier: "homeSearchButton").firstMatch
        guard searchBtn.waitForExistence(timeout: 5) else {
            XCTFail("Search button not found")
            return
        }
        searchBtn.tap()

        let searchField = app.textFields.firstMatch
        guard searchField.waitForExistence(timeout: 5) else {
            XCTFail("Search field not found")
            return
        }
        searchField.tap()
        searchField.typeText("test\n")

        // Toast should appear
        let toast = app.descendants(matching: .any).matching(identifier: "toastMessage").firstMatch
        XCTAssertTrue(toast.waitForExistence(timeout: 15), "Toast should appear when server is down")
        saveScreenshot(named: "01_toast_visible")

        // Wait for auto-dismiss
        sleep(7)
        XCTAssertFalse(toast.isHittable, "Toast should auto-dismiss after timeout")
        saveScreenshot(named: "02_toast_dismissed")
    }

    /// App shows tab bar (not stuck) when server is down on startup, with sign-out escape.
    func testStartupWithServerDown() throws {
        startServer()
        app.launch()

        guard connectToTestServer() else {
            XCTFail("Could not connect to test server")
            return
        }

        stopServer()
        sleep(1)

        app.terminate()
        app.launch()

        let tabBar = app.tabBars.firstMatch
        XCTAssertTrue(tabBar.waitForExistence(timeout: 15),
                      "Tab bar should appear even when server is down")
        saveScreenshot(named: "03_server_down_tabs_visible")

        let meTab = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Me' OR label CONTAINS[c] '我的'")).firstMatch
        XCTAssertTrue(meTab.waitForExistence(timeout: 5))
        meTab.tap()

        let signOutBtn = app.buttons.matching(identifier: "signOutButton").firstMatch
        XCTAssertTrue(signOutBtn.waitForExistence(timeout: 5),
                      "Sign out button should be available as escape route")
        saveScreenshot(named: "04_sign_out_available")
    }
}
