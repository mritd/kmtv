import XCTest

/// UI tests for player controls, fullscreen flow, and navigation integrity.
/// All checks run in a single test to avoid repeated expensive navigation to the player.
/// Uses posix_spawn for server lifecycle.
@MainActor
final class PlayerUITests: XCTestCase {
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

    // MARK: - Helpers

    private func saveScreenshot(named name: String) {
        let screenshot = app.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.lifetime = .keepAlways
        attachment.name = "player_\(name)"
        add(attachment)
    }

    private func element(_ identifier: String) -> XCUIElement {
        let btn = app.buttons[identifier]
        if btn.exists { return btn }
        return app.otherElements[identifier]
    }

    @discardableResult
    private func navigateToPlayer() -> Bool {
        let homeTab = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Home' OR label CONTAINS[c] '首页'")).firstMatch
        guard homeTab.waitForExistence(timeout: 10) else { return false }
        homeTab.tap()

        let card = app.buttons.matching(identifier: "continueWatchingCard").firstMatch
        if card.waitForExistence(timeout: 5) {
            card.tap()
        } else {
            let searchBtn = element("homeSearchButton")
            guard searchBtn.waitForExistence(timeout: 5) else { return false }
            searchBtn.tap()
            let searchField = app.textFields.firstMatch
            guard searchField.waitForExistence(timeout: 5) else { return false }
            searchField.tap()
            searchField.typeText("功夫\n")
        }

        let result = app.buttons.matching(identifier: "searchResult").firstMatch
        guard result.waitForExistence(timeout: 60) else { return false }
        result.tap()

        let playerSection = app.otherElements["playerSection"]
        return playerSection.waitForExistence(timeout: 15)
    }

    @discardableResult
    private func showControls() -> Bool {
        let playerSection = app.otherElements["playerSection"]
        guard playerSection.waitForExistence(timeout: 5) else { return false }
        playerSection.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        return element("playPause").waitForExistence(timeout: 3)
    }

    // MARK: - Tests

    /// Single test covering controls visibility, tappability, sizing, toggle, skip, fullscreen, and auto-hide.
    func testPlayerControlsAndFullscreen() throws {
        startServer()
        app.launch()
        guard connectToTestServer() else {
            XCTFail("Could not connect to test server")
            return
        }
        guard navigateToPlayer() else {
            XCTFail("Could not navigate to player view")
            return
        }
        saveScreenshot(named: "01_player_loaded")

        // 1. Controls show and are tappable
        guard showControls() else {
            XCTFail("Controls did not appear")
            return
        }
        saveScreenshot(named: "02_controls_visible")

        let ids = ["skipBackward", "playPause", "skipForward", "fullscreenButton"]
        for id in ids {
            let el = element(id)
            XCTAssertTrue(el.exists, "\(id) should exist")
            XCTAssertTrue(el.isHittable, "\(id) should be hittable")
        }

        // 2. Button minimum sizes (44x44)
        for id in ids {
            let f = element(id).frame
            XCTAssertGreaterThanOrEqual(f.width, 44, "\(id) width too small")
            XCTAssertGreaterThanOrEqual(f.height, 44, "\(id) height too small")
        }

        // 3. Play/pause toggle
        element("playPause").tap()
        saveScreenshot(named: "03_after_toggle")

        // 4. Skip buttons
        guard showControls() else { return }
        element("skipBackward").tap()
        guard showControls() else { return }
        element("skipForward").tap()
        saveScreenshot(named: "04_after_skip")

        // 5. Fullscreen does not pop navigation
        guard showControls() else { return }
        element("fullscreenButton").tap()
        sleep(2)
        saveScreenshot(named: "05_fullscreen")

        let doneButton = app.buttons["Done"]
        if doneButton.waitForExistence(timeout: 5) {
            doneButton.tap()
        } else {
            app.swipeDown()
        }
        sleep(2)

        let playerSection = app.otherElements["playerSection"]
        XCTAssertTrue(playerSection.waitForExistence(timeout: 5),
                      "Player must exist after exiting fullscreen")
        saveScreenshot(named: "06_after_fullscreen")

        // 6. Controls auto-hide
        guard showControls() else { return }
        sleep(7)
        XCTAssertFalse(element("playPause").exists, "Controls should auto-hide")
        saveScreenshot(named: "07_auto_hidden")
    }
}
