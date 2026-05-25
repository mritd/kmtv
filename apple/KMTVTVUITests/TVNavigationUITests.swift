import XCTest

/// UI tests for tvOS: navigate through all tabs, take screenshots, verify basic layout.
/// Requires test server running at localhost:8080.
@MainActor
final class TVNavigationUITests: XCTestCase {
    private let app = XCUIApplication()
    private let screenshotDir = "/tmp/tvos-screenshots"
    private let remote = XCUIRemote.shared

    override func setUp() async throws {
        continueAfterFailure = false
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

    private func waitForHome() -> Bool {
        let homeTab = app.buttons.matching(NSPredicate(format:
            "label CONTAINS[c] 'Home' OR label CONTAINS[c] '首页'")).firstMatch
        return homeTab.waitForExistence(timeout: 20)
    }

    // MARK: - Tests

    func testNavigateAllTabs() throws {
        app.launch()
        sleep(3)
        save("00_launch")

        // If on setup page, try anonymous connect
        let connectBtn = app.buttons["connectButton"]
        if connectBtn.waitForExistence(timeout: 5) {
            save("01_setup_page")

            // Navigate to URL field and enter server URL
            // The URL field should be focused by default or navigate to it
            let urlField = app.textFields["serverURLField"]
            if urlField.exists {
                remote.press(.select) // Focus URL field to open keyboard
                sleep(1)
                save("02_url_keyboard")
                remote.press(.menu) // Dismiss keyboard
                sleep(1)
            }

            // Navigate down to connect button (skip URL, username, password fields)
            for _ in 0..<6 {
                remote.press(.down)
                usleep(300_000)
            }
            sleep(1)
            save("03_connect_button_focused")
            remote.press(.select)
            sleep(3)
            save("04_connecting")
        }

        // Wait for home to load
        guard waitForHome() else {
            save("FAIL_no_home")
            XCTFail("Could not reach home page")
            return
        }
        sleep(3)

        // === HOME TAB ===
        save("10_home_top")

        // Scroll down through content
        remote.press(.down)
        sleep(1)
        save("11_home_hero_focused")

        remote.press(.down)
        sleep(1)
        save("12_home_first_section")

        // Scroll right through cards
        remote.press(.right)
        sleep(1)
        save("13_home_card_right1")

        remote.press(.right)
        sleep(1)
        save("14_home_card_right2")

        // Scroll down more
        remote.press(.down)
        sleep(1)
        save("15_home_more_sections")

        remote.press(.down)
        sleep(1)
        save("16_home_scroll_down")

        // Select a card to go to search results (Home cards navigate to SearchView)
        remote.press(.select)
        sleep(4)
        save("17_search_from_home")

        // Wait for search results to load, then select the first result to reach DetailView
        let searchResult = app.buttons.matching(NSPredicate(format:
            "identifier == 'searchResult'")).firstMatch
        if searchResult.waitForExistence(timeout: 10) {
            // Navigate down to search results
            remote.press(.down)
            sleep(1)
            remote.press(.down)
            sleep(1)
            save("17b_search_results")

            // Select first search result to navigate to DetailView
            remote.press(.select)
            sleep(4)
            save("18_detail_from_search")

            // Scroll down in detail page
            remote.press(.down)
            sleep(1)
            save("18b_detail_buttons")

            remote.press(.down)
            sleep(1)
            save("19_detail_sources")

            remote.press(.down)
            sleep(1)
            save("19b_detail_episodes")

            // Go back to search results
            remote.press(.menu)
            sleep(2)
        } else {
            save("17b_search_no_results")
        }

        // Go back to home
        remote.press(.menu)
        sleep(2)

        // Navigate back to tab bar
        remote.press(.menu)
        sleep(1)
        for _ in 0..<10 {
            remote.press(.up)
            usleep(200_000)
        }
        sleep(1)

        // === CATEGORIES TAB ===
        // Tab bar should be focused, move right to Categories tab
        remote.press(.right)
        sleep(1)
        remote.press(.select)
        sleep(3)
        save("20_categories_tab")

        // Navigate down to subcategory chips
        remote.press(.down)
        usleep(500_000)
        save("21_categories_main_tabs")

        remote.press(.down)
        usleep(500_000)
        save("22_categories_subcategory")

        // Navigate down to content grid
        remote.press(.down)
        usleep(500_000)
        remote.press(.down)
        usleep(500_000)
        save("23_categories_grid")

        // Scroll right through cards
        remote.press(.right)
        usleep(500_000)
        save("24_categories_card_right")

        // Select a card to view detail
        remote.press(.select)
        sleep(3)
        save("25_categories_detail")

        // Go back
        remote.press(.menu)
        sleep(1)

        // Go back to tab bar
        remote.press(.menu)
        sleep(1)
        for _ in 0..<10 {
            remote.press(.up)
            usleep(200_000)
        }
        sleep(1)

        // === SEARCH TAB - navigate right from Categories ===
        remote.press(.right)
        sleep(1)
        remote.press(.select)
        sleep(2)
        save("30_search_tab")

        // Focus the search field
        remote.press(.down)
        sleep(1)
        save("31_search_keyboard")

        // Go back up to tab bar
        remote.press(.menu)
        sleep(1)
        for _ in 0..<5 {
            remote.press(.up)
            usleep(200_000)
        }
        sleep(1)

        // === FAVORITES TAB ===
        remote.press(.right)
        sleep(1)
        remote.press(.select)
        sleep(2)
        save("40_favorites_tab")

        // Navigate down to favorite items and select one (goes to search)
        remote.press(.down)
        sleep(1)
        save("41_favorites_item_focused")
        remote.press(.select)
        sleep(8) // Wait for search results to load
        save("42_favorites_search_results")

        // Navigate down past search field to results
        remote.press(.down)
        sleep(1)
        remote.press(.down)
        sleep(1)
        save("43_favorites_search_focused")

        // Select a search result to open detail
        remote.press(.select)
        sleep(4)
        save("44_detail_from_favorites")

        // Scroll down to see sources
        remote.press(.down)
        sleep(1)
        save("45_detail_fav_sources")

        remote.press(.down)
        sleep(1)
        save("46_detail_fav_scroll")

        // Go back twice (detail → search → favorites)
        remote.press(.menu)
        sleep(1)
        remote.press(.menu)
        sleep(1)

        // Navigate up to tab bar for settings
        for _ in 0..<5 {
            remote.press(.up)
            usleep(200_000)
        }
        sleep(1)

        // === SETTINGS TAB ===
        remote.press(.right)
        sleep(1)
        remote.press(.select)
        sleep(2)
        save("50_settings_tab")

        // Scroll through settings items
        remote.press(.down)
        sleep(1)
        save("51_settings_item1")

        remote.press(.down)
        sleep(1)
        save("52_settings_item2")
    }
}
