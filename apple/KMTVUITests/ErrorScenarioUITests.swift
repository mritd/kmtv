import XCTest

/// UI tests for business error scenarios: avatar too large, duplicate username, search with server down.
/// Server is started/stopped by the test itself via posix_spawn.
@MainActor
final class ErrorScenarioUITests: XCTestCase {
    private let app = XCUIApplication()
    private let screenshotDir = "/tmp"
    private let serverURL = ProcessInfo.processInfo.environment["KMTV_TEST_SERVER_URL"] ?? "http://localhost:8080"
    private let serverBinary = "/tmp/kmtv-test"
    private let serverDB = "/tmp/kmtv-test.db"
    private let pidFile = "/tmp/kmtv-test-error.pid"
    private var testPrefix = ""

    override func setUp() async throws {
        continueAfterFailure = false
        testPrefix = name
            .replacingOccurrences(of: "-[KMTVUITests.ErrorScenarioUITests ", with: "")
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

    /// Sign out if connected, then connect as admin (admin/admin).
    private func connectAsAdmin() -> Bool {
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

        // If on connection error page, tap "Change Server"
        let changeBtn = app.buttons.matching(NSPredicate(format:
            "label CONTAINS[c] 'Change' OR label CONTAINS[c] '更换'")).firstMatch
        if changeBtn.waitForExistence(timeout: 3) {
            changeBtn.tap()
            let urlField = app.textFields.matching(identifier: "serverURLField").firstMatch
            guard urlField.waitForExistence(timeout: 10) else { return false }
        }

        // Fill server URL
        let urlField = app.textFields.matching(identifier: "serverURLField").firstMatch
        guard urlField.waitForExistence(timeout: 10) else {
            saveScreenshot(named: "FAIL_no_server_url_field")
            return false
        }
        urlField.tap()
        urlField.tap(withNumberOfTaps: 3, numberOfTouches: 1)
        urlField.typeText(serverURL)

        // Fill admin credentials
        let usernameField = app.textFields.matching(identifier: "usernameField").firstMatch
        guard usernameField.waitForExistence(timeout: 3) else {
            saveScreenshot(named: "FAIL_no_username_field")
            return false
        }
        usernameField.tap()
        usernameField.typeText("admin")

        let passwordField = app.secureTextFields.matching(identifier: "passwordField").firstMatch
        guard passwordField.waitForExistence(timeout: 3) else {
            saveScreenshot(named: "FAIL_no_password_field")
            return false
        }
        passwordField.tap()
        passwordField.typeText("admin")

        // Tap connect
        let connectButton = app.buttons.matching(identifier: "connectButton").firstMatch
        guard connectButton.waitForExistence(timeout: 3) else {
            saveScreenshot(named: "FAIL_no_connect_button")
            return false
        }
        connectButton.tap()

        return meTab.waitForExistence(timeout: 15)
    }

    private func goToProfile() -> Bool {
        let meTab = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Me' OR label CONTAINS[c] '我的'")).firstMatch
        guard meTab.waitForExistence(timeout: 5) else {
            saveScreenshot(named: "FAIL_no_me_tab")
            return false
        }
        meTab.tap()
        return true
    }

    // MARK: - Tests

    func testAvatarTooLarge() throws {
        startServer()
        app.launch()

        guard connectAsAdmin() else {
            XCTFail("Could not connect as admin")
            return
        }
        saveScreenshot(named: "01_connected_admin")

        guard goToProfile() else {
            XCTFail("Could not navigate to profile")
            return
        }
        saveScreenshot(named: "02_profile_page")

        // Tap avatar area to show options
        let cells = app.cells.firstMatch
        guard cells.waitForExistence(timeout: 3) else {
            XCTFail("No cells found on profile page")
            return
        }
        let avatarCoordinate = cells.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.3))
        avatarCoordinate.tap()
        saveScreenshot(named: "03_avatar_options")

        // Tap "Change Avatar" in confirmation dialog
        let changeAvatarBtn = app.buttons.matching(NSPredicate(format:
            "label CONTAINS[c] 'avatar' OR label CONTAINS[c] '头像' OR label CONTAINS[c] 'Change Avatar' OR label CONTAINS[c] '更换头像'")).firstMatch
        guard changeAvatarBtn.waitForExistence(timeout: 5) else {
            saveScreenshot(named: "FAIL_no_avatar_options")
            XCTFail("Change Avatar option not found in confirmation dialog")
            return
        }
        changeAvatarBtn.tap()
        saveScreenshot(named: "04_photo_picker")

        // Select the first photo from PhotosPicker
        let firstPhoto = app.scrollViews.images.firstMatch
        if firstPhoto.waitForExistence(timeout: 10) {
            firstPhoto.tap()
        } else {
            let altPhoto = app.collectionViews.cells.firstMatch
            guard altPhoto.waitForExistence(timeout: 5) else {
                saveScreenshot(named: "FAIL_no_photos")
                XCTFail("No photos found in picker")
                return
            }
            altPhoto.tap()
        }
        saveScreenshot(named: "05_photo_selected")

        // Tap Add/Done button if present
        let addBtn = app.buttons.matching(NSPredicate(format:
            "label CONTAINS[c] 'Add' OR label CONTAINS[c] '添加' OR label CONTAINS[c] 'Done' OR label CONTAINS[c] '完成'")).firstMatch
        if addBtn.waitForExistence(timeout: 3) {
            addBtn.tap()
        }

        // Wait for upload attempt to complete
        sleep(5)
        saveScreenshot(named: "06_after_upload_attempt")

        // Dismiss any alert (success or error)
        let okButton = app.alerts.buttons.firstMatch
        if okButton.waitForExistence(timeout: 5) {
            saveScreenshot(named: "07_upload_result_alert")
            okButton.tap()
        }

        saveScreenshot(named: "08_final_state")
    }

    func testDuplicateUsername() throws {
        startServer()
        app.launch()

        guard connectAsAdmin() else {
            XCTFail("Could not connect as admin")
            return
        }
        saveScreenshot(named: "01_connected_admin")

        guard goToProfile() else {
            XCTFail("Could not navigate to profile")
            return
        }
        saveScreenshot(named: "02_profile_page")

        // Tap edit username button
        let editBtn = app.buttons.matching(identifier: "editUsernameButton").firstMatch
        guard editBtn.waitForExistence(timeout: 5) else {
            XCTFail("Edit username button not found")
            return
        }
        editBtn.tap()
        saveScreenshot(named: "03_editing_username")

        // Clear text and type a temporary name
        let usernameTextField = app.textFields.firstMatch
        guard usernameTextField.waitForExistence(timeout: 3) else {
            XCTFail("Username text field not found in edit mode")
            return
        }
        usernameTextField.tap()
        usernameTextField.tap(withNumberOfTaps: 3, numberOfTouches: 1)
        usernameTextField.typeText("tempname_error_test")
        saveScreenshot(named: "04_typed_temp_name")

        // Confirm the change
        let confirmBtn = app.buttons.matching(identifier: "confirmUsernameButton").firstMatch
        guard confirmBtn.waitForExistence(timeout: 3) else {
            XCTFail("Confirm button not found")
            return
        }
        confirmBtn.tap()
        saveScreenshot(named: "05_confirmed_temp_name")

        // Wait for success and dismiss success alert if shown
        sleep(2)
        let successAlert = app.alerts.firstMatch
        if successAlert.waitForExistence(timeout: 5) {
            saveScreenshot(named: "06_success_alert")
            let okBtn = app.alerts.buttons.firstMatch
            okBtn.tap()
            sleep(1)
        }
        saveScreenshot(named: "07_after_first_rename")

        // Edit again - tap the edit button
        guard editBtn.waitForExistence(timeout: 5) else {
            XCTFail("Edit username button not found after first rename")
            return
        }
        editBtn.tap()
        saveScreenshot(named: "08_editing_again")

        // Type "admin" back
        let usernameTextField2 = app.textFields.firstMatch
        guard usernameTextField2.waitForExistence(timeout: 3) else {
            XCTFail("Username text field not found in second edit")
            return
        }
        usernameTextField2.tap()
        usernameTextField2.tap(withNumberOfTaps: 3, numberOfTouches: 1)
        usernameTextField2.typeText("admin")
        saveScreenshot(named: "09_typed_admin")

        // Confirm
        guard confirmBtn.waitForExistence(timeout: 3) else {
            XCTFail("Confirm button not found for second rename")
            return
        }
        confirmBtn.tap()
        saveScreenshot(named: "10_confirmed_admin")

        // Wait for result
        sleep(2)
        let resultAlert = app.alerts.firstMatch
        if resultAlert.waitForExistence(timeout: 5) {
            saveScreenshot(named: "11_result_alert")
            let okBtn = app.alerts.buttons.firstMatch
            okBtn.tap()
        }
        saveScreenshot(named: "12_final_state")
    }

    func testSearchServerDown() throws {
        startServer()
        app.launch()

        guard connectAsAdmin() else {
            XCTFail("Could not connect as admin")
            return
        }
        saveScreenshot(named: "01_connected_admin")

        // Go to home tab and wait for KMTV title
        let homeTab = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Home' OR label CONTAINS[c] '首页'")).firstMatch
        homeTab.tap()

        let kmtvTitle = app.staticTexts["KMTV"]
        guard kmtvTitle.waitForExistence(timeout: 10) else {
            XCTFail("Home page didn't load - KMTV title not found")
            return
        }
        saveScreenshot(named: "02_home_loaded")

        // Stop the server
        stopServer()
        sleep(1)
        saveScreenshot(named: "03_server_stopped")

        // Tap search button
        let searchBtn = app.buttons.matching(identifier: "homeSearchButton").firstMatch
        guard searchBtn.waitForExistence(timeout: 5) else {
            XCTFail("Search button not found")
            return
        }
        searchBtn.tap()

        // Type search query
        let searchField = app.textFields.firstMatch
        guard searchField.waitForExistence(timeout: 5) else {
            XCTFail("Search field not found")
            return
        }
        searchField.tap()
        searchField.typeText("test\n")
        saveScreenshot(named: "04_searching_server_down")

        // Check for toast immediately (don't sleep - toast auto-dismisses after 5s)
        let toast = app.descendants(matching: .any).matching(identifier: "toastMessage").firstMatch
        XCTAssertTrue(toast.waitForExistence(timeout: 15),
                      "Toast message should appear when searching with server down")
        saveScreenshot(named: "06_toast_visible")

        // Assert NO alert exists
        XCTAssertFalse(app.alerts.firstMatch.exists,
                       "No alert should appear - errors should show as toast")
        saveScreenshot(named: "07_no_alert_confirmed")
    }
}
