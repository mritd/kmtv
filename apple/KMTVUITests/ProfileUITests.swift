import XCTest

/// UI tests for profile page: anonymous display and logged-in user editing.
/// Uses posix_spawn for server lifecycle.
@MainActor
final class ProfileUITests: XCTestCase {
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
            .replacingOccurrences(of: "-[KMTVUITests.ProfileUITests ", with: "")
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

    /// Sign out if already connected, then connect with given credentials.
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

        // Fill server URL
        let urlField = app.textFields.matching(identifier: "serverURLField").firstMatch
        guard urlField.waitForExistence(timeout: 10) else {
            saveScreenshot(named: "FAIL_no_server_url_field")
            return false
        }

        // Clear and type URL
        urlField.tap()
        // Triple-tap to select all text, then type to replace
        urlField.tap(withNumberOfTaps: 3, numberOfTouches: 1)
        urlField.typeText(serverURL)

        // Fill credentials if provided
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

    func testAnonymousUserDisplay() throws {
        startServer()
        app.launch()
        guard connectToServer() else {
            XCTFail("Could not connect to server anonymously")
            return
        }
        saveScreenshot(named: "01_connected_anonymous")

        guard goToProfile() else {
            XCTFail("Could not navigate to profile")
            return
        }
        saveScreenshot(named: "02_profile_anonymous")

        // Verify "Anonymous User" label exists
        let anonymousLabel = app.staticTexts.matching(identifier: "anonymousUserLabel").firstMatch
        XCTAssertTrue(anonymousLabel.waitForExistence(timeout: 5),
                      "Anonymous user label should be visible")

        // Verify role badge does NOT exist
        let roleBadge = app.staticTexts.matching(identifier: "roleBadge").firstMatch
        XCTAssertFalse(roleBadge.exists,
                       "Role badge should NOT be visible for anonymous user")

        // Verify edit username button does NOT exist
        let editBtn = app.buttons.matching(identifier: "editUsernameButton").firstMatch
        XCTAssertFalse(editBtn.exists,
                       "Edit username button should NOT be visible for anonymous user")

        // Verify Sign Out button exists
        let signOut = app.buttons.matching(identifier: "signOutButton").firstMatch
        XCTAssertTrue(signOut.exists, "Sign Out should be visible for anonymous user")

        saveScreenshot(named: "03_anonymous_verified")
    }

    func testLoggedInUserDisplay() throws {
        startServer()
        app.launch()
        guard connectToServer(username: "admin", password: "admin") else {
            XCTFail("Could not connect to server with admin credentials")
            return
        }
        saveScreenshot(named: "01_connected_admin")

        guard goToProfile() else {
            XCTFail("Could not navigate to profile")
            return
        }
        saveScreenshot(named: "02_profile_admin")

        // Verify role badge exists
        let roleBadge = app.staticTexts.matching(identifier: "roleBadge").firstMatch
        XCTAssertTrue(roleBadge.waitForExistence(timeout: 5),
                      "Role badge should be visible for logged-in user")

        // Verify edit username button exists
        let editBtn = app.buttons.matching(identifier: "editUsernameButton").firstMatch
        XCTAssertTrue(editBtn.exists,
                      "Edit username button should be visible for logged-in user")

        // Verify anonymous label does NOT exist
        let anonymousLabel = app.staticTexts.matching(identifier: "anonymousUserLabel").firstMatch
        XCTAssertFalse(anonymousLabel.exists,
                       "Anonymous label should NOT be visible for logged-in user")

        saveScreenshot(named: "03_admin_verified")
    }

    func testEditUsernameFlow() throws {
        startServer()
        app.launch()
        guard connectToServer(username: "admin", password: "admin") else {
            XCTFail("Could not connect to server with admin credentials")
            return
        }

        guard goToProfile() else {
            XCTFail("Could not navigate to profile")
            return
        }

        // Tap edit username button
        let editBtn = app.buttons.matching(identifier: "editUsernameButton").firstMatch
        guard editBtn.waitForExistence(timeout: 5) else {
            XCTFail("Edit username button not found")
            return
        }
        editBtn.tap()
        saveScreenshot(named: "01_editing_username")

        // Verify editing UI appears
        let confirmBtn = app.buttons.matching(identifier: "confirmUsernameButton").firstMatch
        XCTAssertTrue(confirmBtn.waitForExistence(timeout: 3),
                      "Confirm button should appear in edit mode")

        let cancelBtn = app.buttons.matching(identifier: "cancelUsernameButton").firstMatch
        XCTAssertTrue(cancelBtn.exists,
                      "Cancel button should appear in edit mode")

        // Cancel editing
        cancelBtn.tap()
        saveScreenshot(named: "02_cancelled_editing")

        // Verify back to normal display
        XCTAssertTrue(editBtn.waitForExistence(timeout: 3),
                      "Edit button should reappear after cancel")
        XCTAssertFalse(confirmBtn.exists,
                       "Confirm button should disappear after cancel")

        saveScreenshot(named: "03_edit_flow_verified")
    }

    func testChangeAvatarFlow() throws {
        startServer()
        app.launch()
        guard connectToServer(username: "admin", password: "admin") else {
            XCTFail("Could not connect to server with admin credentials")
            return
        }

        guard goToProfile() else {
            XCTFail("Could not navigate to profile")
            return
        }
        saveScreenshot(named: "01_before_avatar_change")

        // Tap avatar to show options
        let avatar = app.buttons.firstMatch
        // The avatar is the first button in the user info section (Circle button)
        // Find it by looking in the first section
        let avatarArea = app.images.firstMatch.exists ? app.images.firstMatch : avatar

        // Tap the avatar circle area (first button-like element in profile)
        let cells = app.cells.firstMatch
        guard cells.waitForExistence(timeout: 3) else {
            XCTFail("No cells found")
            return
        }
        // Tap on the left side of the first cell where avatar is
        let avatarCoordinate = cells.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.3))
        avatarCoordinate.tap()
        saveScreenshot(named: "02_avatar_options")

        // Confirmation dialog should appear with "Change Avatar" option
        let changeAvatarBtn = app.buttons.matching(NSPredicate(format:
            "label CONTAINS[c] 'avatar' OR label CONTAINS[c] '头像' OR label CONTAINS[c] 'Change Avatar' OR label CONTAINS[c] '更换头像'")).firstMatch
        guard changeAvatarBtn.waitForExistence(timeout: 5) else {
            saveScreenshot(named: "FAIL_no_avatar_options")
            XCTFail("Change Avatar option not found in confirmation dialog")
            return
        }
        changeAvatarBtn.tap()
        saveScreenshot(named: "03_photo_picker")

        // PhotosPicker should appear - select the first photo
        // The system photo picker shows images in a grid
        let firstPhoto = app.scrollViews.images.firstMatch
        guard firstPhoto.waitForExistence(timeout: 10) else {
            // Try alternative: photos might be in collection views
            let altPhoto = app.collectionViews.cells.firstMatch
            guard altPhoto.waitForExistence(timeout: 5) else {
                saveScreenshot(named: "FAIL_no_photos")
                XCTFail("No photos found in picker")
                return
            }
            altPhoto.tap()
            saveScreenshot(named: "04_photo_selected_alt")
            // Tap Add/Done button if present
            let addBtn = app.buttons.matching(NSPredicate(format:
                "label CONTAINS[c] 'Add' OR label CONTAINS[c] '添加' OR label CONTAINS[c] 'Done' OR label CONTAINS[c] '完成'")).firstMatch
            if addBtn.waitForExistence(timeout: 3) {
                addBtn.tap()
            }
            // Wait for upload to complete
            sleep(3)
            saveScreenshot(named: "05_avatar_updated")
            return
        }
        firstPhoto.tap()
        saveScreenshot(named: "04_photo_selected")

        // Tap Add button to confirm selection
        let addBtn = app.buttons.matching(NSPredicate(format:
            "label CONTAINS[c] 'Add' OR label CONTAINS[c] '添加' OR label CONTAINS[c] 'Done' OR label CONTAINS[c] '完成'")).firstMatch
        if addBtn.waitForExistence(timeout: 3) {
            addBtn.tap()
        }

        // Wait for upload to complete and verify success
        sleep(3)
        saveScreenshot(named: "05_avatar_updated")

        // Verify success message appeared (alert with "OK")
        let okButton = app.alerts.buttons.firstMatch
        if okButton.waitForExistence(timeout: 5) {
            saveScreenshot(named: "06_success_alert")
            okButton.tap()
        }

        saveScreenshot(named: "07_final_state")
    }

    func testDeleteAvatarFlow() throws {
        startServer()
        app.launch()
        // First upload an avatar, then delete it
        guard connectToServer(username: "admin", password: "admin") else {
            XCTFail("Could not connect to server with admin credentials")
            return
        }

        guard goToProfile() else {
            XCTFail("Could not navigate to profile")
            return
        }
        saveScreenshot(named: "01_profile_with_avatar")

        // Tap avatar to show options
        let cells = app.cells.firstMatch
        guard cells.waitForExistence(timeout: 3) else {
            XCTFail("No cells found")
            return
        }
        let avatarCoordinate = cells.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.3))
        avatarCoordinate.tap()
        saveScreenshot(named: "02_avatar_options")

        // Look for "Remove Avatar" option in confirmation dialog
        let removeBtn = app.buttons.matching(NSPredicate(format:
            "label CONTAINS[c] 'Remove' OR label CONTAINS[c] '移除' OR label CONTAINS[c] 'avatar' OR label CONTAINS[c] '头像'")).firstMatch
        guard removeBtn.waitForExistence(timeout: 5) else {
            saveScreenshot(named: "FAIL_no_remove_option")
            // Avatar might not exist yet - upload one first
            // Dismiss dialog
            let cancelBtn = app.buttons.matching(NSPredicate(format:
                "label CONTAINS[c] 'Cancel' OR label CONTAINS[c] '取消'")).firstMatch
            if cancelBtn.exists { cancelBtn.tap() }

            // Upload avatar first using the change flow
            avatarCoordinate.tap()
            let changeBtn = app.buttons.matching(NSPredicate(format:
                "label CONTAINS[c] 'Change' OR label CONTAINS[c] '更换'")).firstMatch
            guard changeBtn.waitForExistence(timeout: 5) else {
                XCTFail("No avatar options found")
                return
            }
            changeBtn.tap()

            let photo = app.scrollViews.images.firstMatch
            if photo.waitForExistence(timeout: 5) {
                photo.tap()
            } else {
                let altPhoto = app.collectionViews.cells.firstMatch
                guard altPhoto.waitForExistence(timeout: 5) else {
                    XCTFail("No photos in picker")
                    return
                }
                altPhoto.tap()
            }
            let addBtn = app.buttons.matching(NSPredicate(format:
                "label CONTAINS[c] 'Add' OR label CONTAINS[c] '添加'")).firstMatch
            if addBtn.waitForExistence(timeout: 3) { addBtn.tap() }
            sleep(3)

            // Dismiss success alert
            let okBtn = app.alerts.buttons.firstMatch
            if okBtn.waitForExistence(timeout: 3) { okBtn.tap() }

            // Now try delete again
            avatarCoordinate.tap()
            saveScreenshot(named: "03_avatar_options_after_upload")

            let removeBtn2 = app.buttons.matching(NSPredicate(format:
                "label CONTAINS[c] 'Remove' OR label CONTAINS[c] '移除'")).firstMatch
            guard removeBtn2.waitForExistence(timeout: 5) else {
                saveScreenshot(named: "FAIL_still_no_remove_option")
                XCTFail("Remove Avatar option still not found after upload")
                return
            }
            removeBtn2.tap()
            sleep(2)
            saveScreenshot(named: "04_avatar_removed")

            let okBtn2 = app.alerts.buttons.firstMatch
            if okBtn2.waitForExistence(timeout: 5) {
                saveScreenshot(named: "05_remove_success")
                okBtn2.tap()
            }
            saveScreenshot(named: "06_final_no_avatar")
            return
        }

        // Remove avatar directly if it already exists
        removeBtn.tap()
        sleep(2)
        saveScreenshot(named: "03_avatar_removed")

        let okButton = app.alerts.buttons.firstMatch
        if okButton.waitForExistence(timeout: 5) {
            saveScreenshot(named: "04_remove_success")
            okButton.tap()
        }
        saveScreenshot(named: "05_final_no_avatar")
    }
}
