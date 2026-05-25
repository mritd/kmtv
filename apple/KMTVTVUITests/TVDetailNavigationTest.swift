import XCTest

/// UI tests for tvOS detail page navigation: verify tab bar persists after
/// Home → Search → Detail → Play → Back, and Categories → Search → Detail → Play → Back.
/// Navigation model: all fullScreenCover (no NavigationStack pushes on tvOS).
/// Requires test server running at localhost:8080 (use `task server`).
@MainActor
final class TVDetailNavigationTest: XCTestCase {
    private let app = XCUIApplication()
    private let screenshotDir = "/tmp/tvos-nav-test"
    private let remote = XCUIRemote.shared

    override func setUp() async throws {
        continueAfterFailure = true
        try? FileManager.default.createDirectory(
            atPath: screenshotDir, withIntermediateDirectories: true)
    }

    private func save(_ name: String) {
        let screenshot = app.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.lifetime = .keepAlways
        attachment.name = name
        add(attachment)
        let path = "\(screenshotDir)/\(name).png"
        try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: path))
    }

    /// Check if tab bar is visible by looking for known tab labels
    private func tabBarExists() -> Bool {
        let tabs = ["Home", "首页", "Categories", "分类", "Search", "搜索",
                     "Favorites", "收藏", "Settings", "设置"]
        for label in tabs {
            let btn = app.buttons.matching(NSPredicate(format:
                "label CONTAINS[c] %@", label)).firstMatch
            if btn.exists {
                return true
            }
        }
        return false
    }

    /// Wait for home tab to be reachable
    private func waitForHome() -> Bool {
        let homeTab = app.buttons.matching(NSPredicate(format:
            "label CONTAINS[c] 'Home' OR label CONTAINS[c] '首页'")).firstMatch
        return homeTab.waitForExistence(timeout: 20)
    }

    /// Pass through setup page if present
    private func handleSetupIfNeeded() {
        let connectBtn = app.buttons["connectButton"]
        if connectBtn.waitForExistence(timeout: 5) {
            for _ in 0..<6 {
                remote.press(.down)
                usleep(300_000)
            }
            sleep(1)
            remote.press(.select)
            sleep(5)
        }
    }

    /// Navigate down to content and select a card (first available item in sections)
    private func selectHomeCard() {
        // Navigate down to hero cards or first section
        remote.press(.down)
        sleep(1)
        remote.press(.down)
        sleep(1)
        // Select the focused card
        remote.press(.select)
        sleep(2)
    }

    /// Wait for search results and select the first one
    private func selectFirstSearchResult() -> Bool {
        let searchResult = app.buttons.matching(NSPredicate(format:
            "identifier == 'searchResult'")).firstMatch
        guard searchResult.waitForExistence(timeout: 20) else { return false }
        // Navigate to results area
        remote.press(.down)
        sleep(1)
        remote.press(.down)
        sleep(1)
        // Select first result
        remote.press(.select)
        sleep(5)
        return true
    }

    /// On detail page, navigate to Play button and press it to enter player
    private func playFromDetail() -> Bool {
        let playBtn = app.buttons.matching(NSPredicate(format:
            "label CONTAINS[c] 'Play' OR label CONTAINS[c] '播放'")).firstMatch
        guard playBtn.waitForExistence(timeout: 10) else { return false }
        // Focus Play button (should be near top of detail)
        // Navigate up to ensure we're at Play button area
        remote.press(.up)
        sleep(1)
        remote.press(.up)
        sleep(1)
        // Select Play
        remote.press(.select)
        sleep(3)
        return true
    }

    // MARK: - Test 1: Home → Search → Detail → Play → Back

    func testHomeToDetailNavigation() throws {
        app.launch()
        sleep(3)
        save("H00_launch")

        handleSetupIfNeeded()

        guard waitForHome() else {
            save("H_FAIL_no_home")
            XCTFail("Could not reach home page")
            return
        }
        sleep(3)

        // Check tab bar at start
        save("H01_home_loaded")
        XCTAssertTrue(tabBarExists(), "Tab bar should exist on home page")

        // Select a card from home → opens SearchView as fullScreenCover
        selectHomeCard()
        sleep(5)
        save("H02_search_view")

        // Wait for search results and select first
        guard selectFirstSearchResult() else {
            save("H_FAIL_no_results")
            XCTFail("No search results found")
            return
        }
        save("H03_detail_page")

        // Press Play to enter full screen player
        if playFromDetail() {
            save("H04_player")

            // Exit player (Menu dismisses player fullScreenCover)
            remote.press(.menu)
            sleep(2)
            save("H05_back_from_player")
        } else {
            save("H04_no_play_btn")
        }

        // Exit detail (Menu dismisses detail fullScreenCover)
        remote.press(.menu)
        sleep(2)
        save("H06_back_to_search")

        // Exit search (Menu dismisses search fullScreenCover)
        remote.press(.menu)
        sleep(2)
        save("H07_back_to_home")

        // Verify tab bar is present
        let tabBarAfterReturn = tabBarExists()
        save("H08_tabbar_check")
        XCTAssertTrue(tabBarAfterReturn, "Tab bar should be visible after full navigation cycle")
    }

    // MARK: - Test 2: Categories → Search → Detail → Play → Back

    func testCategoriesToDetailNavigation() throws {
        app.launch()
        sleep(3)

        handleSetupIfNeeded()

        guard waitForHome() else {
            save("C_FAIL_no_home")
            XCTFail("Could not reach home page")
            return
        }
        sleep(3)
        save("C01_home_loaded")

        // Navigate to Categories tab
        // First move focus up to tab bar
        for _ in 0..<10 {
            remote.press(.up)
            usleep(200_000)
        }
        sleep(1)
        // Move right to Categories tab
        remote.press(.right)
        sleep(1)
        remote.press(.select)
        sleep(3)
        save("C02_categories_tab")

        XCTAssertTrue(tabBarExists(), "Tab bar should exist on categories page")

        // Navigate down to category grid content
        remote.press(.down)
        usleep(500_000)
        remote.press(.down)
        usleep(500_000)
        remote.press(.down)
        usleep(500_000)
        remote.press(.down)
        usleep(500_000)
        save("C03_categories_grid")

        // Select a video card → opens SearchView as fullScreenCover
        remote.press(.select)
        sleep(5)
        save("C04_search_view")

        // Wait for search results and select first
        guard selectFirstSearchResult() else {
            save("C_FAIL_no_results")
            XCTFail("No search results found")
            return
        }
        save("C05_detail_page")

        // Press Play to enter full screen player
        if playFromDetail() {
            save("C06_player")

            // Exit player
            remote.press(.menu)
            sleep(2)
            save("C07_back_from_player")
        } else {
            save("C06_no_play_btn")
        }

        // Exit detail
        remote.press(.menu)
        sleep(2)
        save("C08_back_to_search")

        // Exit search
        remote.press(.menu)
        sleep(2)
        save("C09_back_to_categories")

        // Verify tab bar
        let tabBarAfterReturn = tabBarExists()
        save("C10_tabbar_check")
        XCTAssertTrue(tabBarAfterReturn, "Tab bar should be visible after full navigation cycle")
    }
}
