import XCTest

/// UI tests for admin settings page: verify numeric field alignment.
@MainActor
final class AdminSettingsUITests: XCTestCase {
    private let app = XCUIApplication()
    private let screenshotDir = "/tmp"
    private let serverURL = ProcessInfo.processInfo.environment["KMTV_TEST_SERVER_URL"] ?? "http://localhost:8080"
    private let serverBinary = "/tmp/kmtv-test"
    private let serverDB = "/tmp/kmtv-test.db"
    private let pidFile = "/tmp/kmtv-test-admin-settings.pid"
    private var testPrefix = ""

    override func setUp() async throws {
        continueAfterFailure = false
        testPrefix = name
            .replacingOccurrences(of: "-[KMTVUITests.AdminSettingsUITests ", with: "")
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
            strdup(serverBinary), strdup("--listen"), strdup("0.0.0.0:8080"),
            strdup("--db-path"), strdup(serverDB), nil
        ]
        let env = environ
        var fileActions: posix_spawn_file_actions_t?
        posix_spawn_file_actions_init(&fileActions)
        posix_spawn_file_actions_addopen(&fileActions, STDOUT_FILENO, "/dev/null", O_WRONLY, 0)
        posix_spawn_file_actions_addopen(&fileActions, STDERR_FILENO, "/dev/null", O_WRONLY, 0)
        let status = posix_spawn(&pid, serverBinary, &fileActions, nil, argv, env)
        posix_spawn_file_actions_destroy(&fileActions)
        argv.forEach { free($0) }
        if status == 0 { try? "\(pid)".write(toFile: pidFile, atomically: true, encoding: .utf8) }
        for _ in 0..<30 {
            if let data = try? Data(contentsOf: URL(string: "\(serverURL)/api/v1/settings")!), !data.isEmpty { return }
            Thread.sleep(forTimeInterval: 0.5)
        }
    }

    private func stopServer() {
        if let pidStr = try? String(contentsOfFile: pidFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
           let pid = pid_t(pidStr) {
            kill(pid, SIGTERM)
            for _ in 0..<20 { if kill(pid, 0) != 0 { break }; Thread.sleep(forTimeInterval: 0.1) }
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

    private func connectToServer(username: String = "", password: String = "") -> Bool {
        let meTab = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Me' OR label CONTAINS[c] '我的'")).firstMatch

        // If already connected, sign out first
        if meTab.waitForExistence(timeout: 3) {
            meTab.tap()
            let signOutBtn = app.buttons.matching(identifier: "signOutButton").firstMatch
            if signOutBtn.waitForExistence(timeout: 5) {
                signOutBtn.tap()
                let urlField = app.textFields.matching(identifier: "serverURLField").firstMatch
                guard urlField.waitForExistence(timeout: 10) else {
                    saveScreenshot(named: "FAIL_signout_no_setup")
                    return false
                }
            }
        }

        let urlField = app.textFields.matching(identifier: "serverURLField").firstMatch
        guard urlField.waitForExistence(timeout: 10) else {
            saveScreenshot(named: "FAIL_no_server_url_field")
            return false
        }

        urlField.tap()
        urlField.tap(withNumberOfTaps: 3, numberOfTouches: 1)
        urlField.typeText(serverURL)

        if !username.isEmpty {
            let usernameField = app.textFields.matching(identifier: "usernameField").firstMatch
            guard usernameField.waitForExistence(timeout: 3) else {
                saveScreenshot(named: "FAIL_no_username_field")
                return false
            }
            usernameField.tap()
            usernameField.typeText(username)

            let passwordField = app.secureTextFields.matching(identifier: "passwordField").firstMatch
            guard passwordField.waitForExistence(timeout: 3) else {
                saveScreenshot(named: "FAIL_no_password_field")
                return false
            }
            passwordField.tap()
            passwordField.typeText(password)
        }

        let connectButton = app.buttons.matching(identifier: "connectButton").firstMatch
        guard connectButton.waitForExistence(timeout: 3) else {
            saveScreenshot(named: "FAIL_no_connect_button")
            return false
        }
        connectButton.tap()

        return meTab.waitForExistence(timeout: 15)
    }

    // MARK: - Tests

    func testSettingsNumericFieldAlignment() throws {
        startServer()
        app.launch()
        guard connectToServer(username: "admin", password: "admin") else {
            XCTFail("Could not connect to server with admin credentials")
            return
        }
        saveScreenshot(named: "01_connected")

        // Navigate to profile
        let meTab = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Me' OR label CONTAINS[c] '我的'")).firstMatch
        guard meTab.waitForExistence(timeout: 5) else {
            XCTFail("Me tab not found")
            return
        }
        meTab.tap()
        saveScreenshot(named: "02_profile")

        // Tap Admin Panel
        let adminLink = app.buttons.matching(NSPredicate(format:
            "label CONTAINS[c] 'Admin' OR label CONTAINS[c] '管理'")).firstMatch
        guard adminLink.waitForExistence(timeout: 5) else {
            saveScreenshot(named: "FAIL_no_admin_link")
            XCTFail("Admin Panel link not found")
            return
        }
        adminLink.tap()
        saveScreenshot(named: "03_admin_page")

        // Switch to Settings tab (4th segment)
        let settingsSegment = app.buttons.matching(NSPredicate(format:
            "label CONTAINS[c] 'Settings' OR label CONTAINS[c] '设置'")).firstMatch
        guard settingsSegment.waitForExistence(timeout: 5) else {
            saveScreenshot(named: "FAIL_no_settings_tab")
            XCTFail("Settings tab not found")
            return
        }
        settingsSegment.tap()
        sleep(1)
        saveScreenshot(named: "04_settings_tab")

        // Scroll down to Performance section
        let performanceHeader = app.staticTexts.matching(NSPredicate(format:
            "label CONTAINS[c] 'Performance' OR label CONTAINS[c] '性能'")).firstMatch
        if !performanceHeader.isHittable {
            app.swipeUp()
            sleep(1)
        }
        saveScreenshot(named: "05_performance_section")
    }
}
