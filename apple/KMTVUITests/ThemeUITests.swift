import XCTest

/// UI tests for light/dark theme adaptation.
/// Screenshots all main tabs in the current color scheme.
/// Uses posix_spawn for server lifecycle.
///
/// To test both modes, set the simulator appearance before running:
///   xcrun simctl ui booted appearance light
///   xcrun simctl ui booted appearance dark
@MainActor
final class ThemeUITests: XCTestCase {
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
        attachment.name = "theme_\(name)"
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

    /// Screenshot all tabs in current appearance mode.
    /// Pre-requisite: set appearance with `xcrun simctl ui booted appearance light/dark`
    func testAllPagesScreenshot() throws {
        startServer()
        app.launch()

        guard connectToTestServer() else {
            XCTFail("Could not connect to test server")
            return
        }

        // Home
        sleep(3)
        saveScreenshot(named: "01_home")
        app.swipeUp()
        sleep(1)
        saveScreenshot(named: "02_home_scrolled")
        app.swipeDown()

        // Categories
        app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Categories' OR label CONTAINS[c] '分类'")).firstMatch.tap()
        sleep(3)
        saveScreenshot(named: "03_categories")

        // Favorites
        app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Favorites' OR label CONTAINS[c] '收藏'")).firstMatch.tap()
        sleep(2)
        saveScreenshot(named: "04_favorites")

        // Profile
        app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Me' OR label CONTAINS[c] '我的'")).firstMatch.tap()
        sleep(2)
        saveScreenshot(named: "05_profile")

        // Search
        app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Home' OR label CONTAINS[c] '首页'")).firstMatch.tap()
        sleep(1)
        let searchBtn = app.buttons.matching(identifier: "homeSearchButton").firstMatch
        if searchBtn.waitForExistence(timeout: 5) {
            searchBtn.tap()
            sleep(2)
            saveScreenshot(named: "06_search")
        }
    }
}
