import XCTest

/// UI tests for categories page.
/// Uses posix_spawn for server lifecycle.
@MainActor
final class CategoriesUITests: XCTestCase {
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
        attachment.name = "categories_\(name)"
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

    /// Single test covering tab existence, content loading, category/subcategory/region switching.
    func testCategoriesNavigation() throws {
        startServer()
        app.launch()

        guard connectToTestServer() else {
            XCTFail("Could not connect to test server")
            return
        }

        // Tab exists
        let categoriesTab = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Categories' OR label CONTAINS[c] '分类'")).firstMatch
        XCTAssertTrue(categoriesTab.waitForExistence(timeout: 10), "Categories tab should exist")
        categoriesTab.tap()

        // Title loads
        let title = app.staticTexts.matching(identifier: "categoriesTitle").firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 10), "Categories title should appear")

        // Main category tabs exist and are switchable
        let movieTab = app.buttons.matching(identifier: "mainCategory_movie").firstMatch
        XCTAssertTrue(movieTab.waitForExistence(timeout: 10), "Movie tab should appear")
        movieTab.tap()
        saveScreenshot(named: "01_movie")

        for key in ["tv", "anime", "show"] {
            let tab = app.buttons.matching(identifier: "mainCategory_\(key)").firstMatch
            XCTAssertTrue(tab.waitForExistence(timeout: 5), "\(key) tab should exist")
            tab.tap()
            sleep(2)
        }
        saveScreenshot(named: "02_show_selected")

        // Switch back to movie for subcategory/region tests
        movieTab.tap()
        sleep(3)

        // Subcategory selection
        let popularChip = app.buttons.matching(identifier: "subCategory_热门").firstMatch
        XCTAssertTrue(popularChip.waitForExistence(timeout: 10), "Popular chip should appear")
        popularChip.tap()
        sleep(3)
        saveScreenshot(named: "03_popular")

        // Region selection
        let chineseRegion = app.buttons.matching(identifier: "region_华语").firstMatch
        XCTAssertTrue(chineseRegion.waitForExistence(timeout: 10), "Chinese region should appear")
        chineseRegion.tap()
        sleep(3)
        saveScreenshot(named: "04_chinese_region")
    }

    /// Comprehensive test: verify all category/subcategory/region combos load data.
    /// Uses user-started backend (no posix_spawn).
    func testAllCategoryTabsHaveData() throws {
        app.launch()

        guard connectToTestServer() else {
            XCTFail("Could not connect to test server")
            return
        }

        let categoriesTab = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Categories' OR label CONTAINS[c] '分类'")).firstMatch
        XCTAssertTrue(categoriesTab.waitForExistence(timeout: 10))
        categoriesTab.tap()

        let tabs: [(key: String, name: String, subs: [String], regions: [String])] = [
            ("movie", "电影", ["全部", "热门", "最新", "豆瓣高分", "冷门佳片"], ["全部", "华语", "欧美", "韩国", "日本"]),
            ("tv",    "剧集", ["全部", "热门"],                              ["全部", "国产", "欧美", "日本", "韩国"]),
            ("anime", "动画", ["番剧", "剧场版"],                              []),
            ("show",  "综艺", ["全部", "热门"],                              ["全部", "国内", "国外"]),
        ]

        var failures: [String] = []

        for tab in tabs {
            let mainTab = app.buttons.matching(identifier: "mainCategory_\(tab.key)").firstMatch
            guard mainTab.waitForExistence(timeout: 10) else {
                failures.append("\(tab.name): main tab not found")
                continue
            }
            mainTab.tap()
            sleep(3)

            for sub in tab.subs {
                let subBtn = app.buttons.matching(identifier: "subCategory_\(sub)").firstMatch
                guard subBtn.waitForExistence(timeout: 5) else {
                    failures.append("\(tab.name)/\(sub): not found")
                    continue
                }
                subBtn.tap()
                sleep(4)

                let emptyState = app.staticTexts.matching(identifier: "categoriesEmptyState").firstMatch
                if emptyState.exists {
                    failures.append("\(tab.name)/\(sub)/全部: no data")
                }
            }

            if let firstSub = tab.subs.first {
                let firstSubBtn = app.buttons.matching(identifier: "subCategory_\(firstSub)").firstMatch
                if firstSubBtn.waitForExistence(timeout: 5) {
                    firstSubBtn.tap()
                    sleep(2)
                }
            }

            for region in tab.regions where region != "全部" {
                let regionBtn = app.buttons.matching(identifier: "region_\(region)").firstMatch
                guard regionBtn.waitForExistence(timeout: 5) else {
                    failures.append("\(tab.name)/region \(region): not found")
                    continue
                }
                regionBtn.tap()
                sleep(4)

                let emptyState = app.staticTexts.matching(identifier: "categoriesEmptyState").firstMatch
                if emptyState.exists {
                    failures.append("\(tab.name)/\(tab.subs.first ?? "")/\(region): no data")
                }
            }

            let allRegionBtn = app.buttons.matching(identifier: "region_全部").firstMatch
            if allRegionBtn.waitForExistence(timeout: 3) {
                allRegionBtn.tap()
                sleep(1)
            }
        }

        if !failures.isEmpty {
            XCTFail("Categories with no data:\n" + failures.joined(separator: "\n"))
        }
    }
}
