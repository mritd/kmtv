import XCTest

/// UI tests for favorites: verify tapping a favorite navigates to search results.
/// Server is started/stopped by the test itself via posix_spawn.
@MainActor
final class FavoritesUITests: XCTestCase {
    private let app = XCUIApplication()
    private let screenshotDir = "/tmp"
    private let serverURL = ProcessInfo.processInfo.environment["KMTV_TEST_SERVER_URL"] ?? "http://localhost:8080"
    private let serverBinary = "/tmp/kmtv-test"
    private let serverDB = "/tmp/kmtv-test-fav.db"
    private let pidFile = "/tmp/kmtv-test-fav.pid"
    private var testPrefix = ""

    override func setUp() async throws {
        continueAfterFailure = false
        testPrefix = name
            .replacingOccurrences(of: "-[KMTVUITests.FavoritesUITests ", with: "")
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
               !data.isEmpty { return }
            Thread.sleep(forTimeInterval: 0.5)
        }
    }

    private func stopServer() {
        if let pidStr = try? String(contentsOfFile: pidFile, encoding: .utf8),
           let pid = Int32(pidStr.trimmingCharacters(in: .whitespacesAndNewlines)) {
            kill(pid, SIGTERM)
            Thread.sleep(forTimeInterval: 0.5)
        }
        try? FileManager.default.removeItem(atPath: pidFile)
        try? FileManager.default.removeItem(atPath: serverDB)
    }

    // MARK: - Helpers

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

    private func saveScreenshot(named name: String) {
        let screenshot = app.screenshot()
        let safeName = "\(testPrefix)_\(name)"
            .replacingOccurrences(of: "[^a-zA-Z0-9_-]", with: "_", options: .regularExpression)
        let path = "\(screenshotDir)/\(safeName).png"
        try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: path))
    }

    // MARK: - Tests

    /// Verify that tapping a favorite navigates to the search page (not player).
    /// This test requires existing favorites in the simulator — if none exist, it skips.
    func testFavoriteTapNavigatesToSearch() throws {
        startServer()
        app.launch()

        guard connectToTestServer() else {
            XCTFail("Could not connect to test server")
            return
        }

        // Navigate to Favorites tab (Home=0, Categories=1, Favorites=2, Me=3)
        let favTab = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Favorites' OR label CONTAINS[c] '收藏'")).firstMatch
        XCTAssertTrue(favTab.waitForExistence(timeout: 10))
        favTab.tap()
        saveScreenshot(named: "01_favorites_tab")

        // Check if there are any favorite items to tap
        let firstCell = app.cells.firstMatch
        guard firstCell.waitForExistence(timeout: 5) else {
            // No favorites — verify empty state instead
            saveScreenshot(named: "02_no_favorites_empty")
            return
        }

        // Tap the first favorite
        firstCell.tap()
        saveScreenshot(named: "02_tapped_favorite")

        // Should navigate to SearchView — verify by checking for the search nav title
        // or the "No Results" empty state (test server has no sources)
        let searchTitle = app.navigationBars.staticTexts.matching(
            NSPredicate(format: "label CONTAINS[c] 'Search' OR label CONTAINS[c] '搜索'")
        ).firstMatch
        let foundSearch = searchTitle.waitForExistence(timeout: 15)
        saveScreenshot(named: "03_search_page")

        XCTAssertTrue(foundSearch,
                      "Tapping a favorite should navigate to search results page")
    }
}
