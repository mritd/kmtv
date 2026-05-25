import XCTest

/// Verify SSE search progress text is displayed during search.
@MainActor
final class SSEProgressUITests: XCTestCase {
    private let app = XCUIApplication()
    private let screenshotDir = "/tmp"
    private let serverURL = ProcessInfo.processInfo.environment["KMTV_TEST_SERVER_URL"] ?? "http://localhost:8081"
    private let serverBinary = "/tmp/kmtv-test"
    private let serverDB = "/tmp/kmtv-sse-test.db"
    private let pidFile = "/tmp/kmtv-sse-test.pid"
    private var testPrefix = ""

    override func setUp() async throws {
        continueAfterFailure = false
        testPrefix = name
            .replacingOccurrences(of: "-[KMTVUITests.SSEProgressUITests ", with: "")
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
            strdup("--listen"), strdup("0.0.0.0:8081"),
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

    // MARK: - API Helpers

    /// Creates a test source via the admin API so there's something to search.
    private func createTestSource() {
        // Login as admin to get a bearer token for protected admin APIs.
        // 以 admin 登录并获取 bearer token, 用于访问受保护的管理 API.
        guard let loginURL = URL(string: "\(serverURL)/api/v1/auth/login") else { return }
        var loginReq = URLRequest(url: loginURL)
        loginReq.httpMethod = "POST"
        loginReq.setValue("application/json", forHTTPHeaderField: "Content-Type")
        loginReq.httpBody = try? JSONSerialization.data(withJSONObject: [
            "username": "admin",
            "password": "admin"
        ])

        let sem = DispatchSemaphore(value: 0)
        var accessToken: String?

        let session = URLSession(configuration: .default)
        session.dataTask(with: loginReq) { data, _, _ in
            if let data,
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let token = json["access_token"] as? String {
                accessToken = token
            }
            sem.signal()
        }.resume()
        sem.wait()

        guard let accessToken else { return }

        // Create a test source
        guard let sourceURL = URL(string: "\(serverURL)/api/v1/admin/sources") else { return }
        var sourceReq = URLRequest(url: sourceURL)
        sourceReq.httpMethod = "POST"
        sourceReq.setValue("application/json", forHTTPHeaderField: "Content-Type")
        sourceReq.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        sourceReq.httpBody = try? JSONSerialization.data(withJSONObject: [
            "name": "Test Source",
            "key": "test_source",
            "api": "https://test.example.com/api.php/provide/vod/",
            "enabled": true
        ])

        let sem2 = DispatchSemaphore(value: 0)
        session.dataTask(with: sourceReq) { _, _, _ in
            sem2.signal()
        }.resume()
        sem2.wait()
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

    func testSSEProgressAppearsWhileSearching() throws {
        startServer()
        createTestSource()
        app.launch()

        guard connectToTestServer() else {
            saveScreenshot(named: "FAIL_connect")
            XCTFail("Could not connect to test server")
            return
        }

        saveScreenshot(named: "01_connected")

        // Navigate to search
        let searchBtn = app.buttons.matching(identifier: "homeSearchButton").firstMatch
        guard searchBtn.waitForExistence(timeout: 5) else {
            saveScreenshot(named: "FAIL_no_search_button")
            XCTFail("Search button not found")
            return
        }
        searchBtn.tap()
        sleep(1)
        saveScreenshot(named: "02_search_page")

        // Type a search query
        let textField = app.textFields.firstMatch
        guard textField.waitForExistence(timeout: 5) else {
            saveScreenshot(named: "FAIL_no_textfield")
            XCTFail("No text field found")
            return
        }
        textField.tap()
        textField.typeText("test")

        saveScreenshot(named: "03_query_entered")

        // Submit search (press return key)
        app.keyboards.buttons["search"].tap()
        saveScreenshot(named: "04_search_submitted")

        // Check for progress indicator - it should appear within a few seconds
        // The progress element has accessibilityIdentifier "searchProgress"
        let progress = app.otherElements.matching(identifier: "searchProgress").firstMatch
        // Also look for text containing "Searching" or progress keywords
        let searchingText = app.staticTexts.matching(NSPredicate(format:
            "label CONTAINS[c] 'Searching' OR label CONTAINS[c] 'Probing' OR label CONTAINS[c] '搜索'")).firstMatch

        // Give it up to 5 seconds for progress to appear
        let progressAppeared = progress.waitForExistence(timeout: 5)
            || searchingText.waitForExistence(timeout: 1)

        saveScreenshot(named: "05_during_search")

        // Wait for search to complete (results or empty state)
        let resultOrEmpty = app.staticTexts.matching(NSPredicate(format:
            "label CONTAINS[c] 'No results' OR label CONTAINS[c] 'sources'")).firstMatch
        _ = resultOrEmpty.waitForExistence(timeout: 30)

        saveScreenshot(named: "06_search_complete")

        // The key assertion: progress text should have appeared during the search
        // With the SSE fix, progress events are delivered incrementally
        XCTAssertTrue(progressAppeared,
            "SSE progress text should appear during search. " +
            "If this fails, URLSession.bytes.lines may be buffering SSE events.")
    }
}
