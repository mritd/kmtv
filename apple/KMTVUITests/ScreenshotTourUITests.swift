import XCTest

/// Visual tour: walks the main iOS screens against the app's current server
/// session and writes one PNG per screen. It never signs out or edits data.
///
/// Run with `TEST_RUNNER_KMTV_SHOT_DIR=<dir>` and optionally
/// `TEST_RUNNER_KMTV_SHOT_PREFIX=light`; without a directory it does nothing.
@MainActor
final class ScreenshotTourUITests: XCTestCase {
    private let app = XCUIApplication()
    private let env = ProcessInfo.processInfo.environment

    func testTour() throws {
        guard let dir = env["KMTV_SHOT_DIR"], !dir.isEmpty else {
            throw XCTSkip("KMTV_SHOT_DIR not set")
        }
        let prefix = env["KMTV_SHOT_PREFIX"] ?? "shot"
        app.launch()
        guard tab(0).waitForExistence(timeout: 20) else {
            shot("00-launch", dir: dir, prefix: prefix)
            return
        }
        // Usually still the loading skeleton.
        shot("00-loading", dir: dir, prefix: prefix)
        sleep(4)

        shot("01-home", dir: dir, prefix: prefix)
        app.swipeUp()
        sleep(2)
        shot("02-home-scrolled", dir: dir, prefix: prefix)
        app.swipeDown()
        app.swipeDown()

        // Home card -> search results -> player.
        let card = app.buttons.matching(identifier: "continueWatchingCard").firstMatch
        if card.waitForExistence(timeout: 3) {
            card.tap()
            sleep(6)
            shot("03-search", dir: dir, prefix: prefix)
            let result = app.descendants(matching: .any).matching(identifier: "searchResult").firstMatch
            if result.waitForExistence(timeout: 15) {
                result.tap()
                sleep(6)
                shot("04-player", dir: dir, prefix: prefix)
                app.swipeUp()
                sleep(1)
                shot("05-player-scrolled", dir: dir, prefix: prefix)
                let favorite = app.buttons.matching(identifier: "favoriteButton").firstMatch
                if favorite.exists, env["KMTV_SHOT_FAVORITE"] == "1" { favorite.tap() }
                let download = app.buttons.matching(identifier: "downloadButton").firstMatch
                if download.exists {
                    download.tap()
                    sleep(2)
                    shot("05b-episode-picker", dir: dir, prefix: prefix)
                    app.swipeDown(velocity: .fast)
                    sleep(1)
                }
            }
        }

        tapTab(1)
        sleep(4)
        shot("06-categories", dir: dir, prefix: prefix)
        app.swipeUp()
        sleep(2)
        shot("07-categories-scrolled", dir: dir, prefix: prefix)
        for _ in 0..<3 { app.swipeUp() }
        let backToTop = app.buttons.matching(identifier: "backToTop").firstMatch
        if backToTop.waitForExistence(timeout: 3) {
            shot("07a-categories-deep", dir: dir, prefix: prefix)
            backToTop.tap()
            sleep(1)
            shot("07aa-categories-back-to-top", dir: dir, prefix: prefix)
        }
        app.swipeDown()
        app.swipeDown()
        // Switching groups reloads, so the next shot usually catches the loading skeleton.
        let series = app.buttons.matching(identifier: "mainCategory_tv").firstMatch
        if series.waitForExistence(timeout: 3) {
            series.tap()
            shot("07b-categories-loading", dir: dir, prefix: prefix)
            sleep(3)
            shot("07c-categories-series", dir: dir, prefix: prefix)
        }

        tapTab(2)
        sleep(3)
        shot("08-favorites", dir: dir, prefix: prefix)

        tapTab(3)
        sleep(3)
        shot("09-downloads", dir: dir, prefix: prefix)
        // A show row carries a "done/total" episode count; the storage footer does not.
        let row = app.collectionViews.cells
            .containing(NSPredicate(format: "label MATCHES %@", "^[0-9]+/[0-9]+.*")).firstMatch
        let swipes = env["KMTV_SHOT_SWIPE"] == "1"
        if row.waitForExistence(timeout: 3) {
            // Optional swipe checks reveal the delete action and close it again without tapping it.
            if swipes {
                row.swipeLeft()
                sleep(1)
                shot("09b-downloads-swipe", dir: dir, prefix: prefix)
                row.swipeRight()
                sleep(1)
            }
            row.tap()
            sleep(3)
            shot("10-download-show", dir: dir, prefix: prefix)
            if swipes {
                let episode = app.collectionViews.cells
                    .containing(NSPredicate(format: "label MATCHES %@", ".*(第[0-9]+集|Episode [0-9]+).*")).firstMatch
                if episode.waitForExistence(timeout: 3) {
                    episode.swipeLeft()
                    sleep(1)
                    shot("10c-episode-swipe", dir: dir, prefix: prefix)
                    episode.swipeRight()
                    sleep(1)
                    let edit = app.buttons.matching(NSPredicate(format: "label IN %@", ["Edit", "编辑"])).firstMatch
                    if edit.waitForExistence(timeout: 3) {
                        edit.tap()
                        sleep(1)
                        episode.tap()
                        sleep(1)
                        shot("10d-episode-edit", dir: dir, prefix: prefix)
                        app.buttons.matching(NSPredicate(format: "label IN %@", ["Done", "完成"])).firstMatch.tap()
                        sleep(1)
                    }
                }
            }
            // Optional, since playing moves the episode's saved position a few seconds.
            if env["KMTV_SHOT_PLAY"] == "1" {
                let play = app.buttons.matching(NSPredicate(format: "label IN %@", ["Play", "播放"])).firstMatch
                if play.waitForExistence(timeout: 3) {
                    play.tap()
                    sleep(8)
                    shot("10b-offline-player", dir: dir, prefix: prefix)
                    let close = app.buttons.matching(NSPredicate(format: "label IN %@", ["Close", "关闭", "Done", "完成"])).firstMatch
                    if close.exists { close.tap() }
                    sleep(1)
                }
            }
            app.navigationBars.buttons.firstMatch.tap()
        }

        tapTab(4)
        sleep(3)
        shot("11-profile", dir: dir, prefix: prefix)
        app.swipeUp()
        sleep(1)
        shot("12-profile-scrolled", dir: dir, prefix: prefix)
        app.swipeDown()
        let admin = app.staticTexts.matching(NSPredicate(format: "label IN %@", ["Admin Panel", "管理面板"])).firstMatch
        if admin.waitForExistence(timeout: 3) {
            admin.tap()
            sleep(3)
            shot("12b-admin", dir: dir, prefix: prefix)
            app.swipeUp()
            sleep(1)
            shot("12c-admin-scrolled", dir: dir, prefix: prefix)
            let settings = app.buttons.matching(NSPredicate(format: "label IN %@", ["Settings", "设置"])).firstMatch
            if settings.exists {
                app.swipeDown()
                settings.tap()
                sleep(2)
                shot("12d-admin-settings", dir: dir, prefix: prefix)
            }
            app.navigationBars.buttons.firstMatch.tap()
            sleep(1)
        }

        tapTab(0)
        let search = app.buttons.matching(identifier: "homeSearchButton").firstMatch
        if search.waitForExistence(timeout: 3) {
            search.tap()
            sleep(2)
            shot("13-search-empty", dir: dir, prefix: prefix)
        }
    }

    /// Opens the first downloaded show and its "Download More" player, then shoots the player.
    func testDownloadMorePlayer() throws {
        guard let dir = env["KMTV_SHOT_DIR"], !dir.isEmpty else { throw XCTSkip("KMTV_SHOT_DIR not set") }
        let prefix = env["KMTV_SHOT_PREFIX"] ?? "shot"
        app.launch()
        XCTAssertTrue(tab(3).waitForExistence(timeout: 20))
        tapTab(3)
        let row = app.collectionViews.cells
            .containing(NSPredicate(format: "label MATCHES %@", "^[0-9]+/[0-9]+.*")).firstMatch
        guard row.waitForExistence(timeout: 5) else { return shot("dm-00-no-downloads", dir: dir, prefix: prefix) }
        row.tap()
        let more = app.buttons.matching(NSPredicate(format: "label IN %@", ["Download More", "下载更多"])).firstMatch
        XCTAssertTrue(more.waitForExistence(timeout: 5))
        more.tap()
        sleep(3)
        shot("dm-01-player-3s", dir: dir, prefix: prefix)
        sleep(7)
        shot("dm-02-player-10s", dir: dir, prefix: prefix)
    }

    /// Menu items must expose their identifiers, since CategoriesUITests picks regions through them.
    func testRegionMenuItemsAreReachable() throws {
        guard env["KMTV_SHOT_DIR"] != nil else { throw XCTSkip("KMTV_SHOT_DIR not set") }
        app.launch()
        XCTAssertTrue(tab(0).waitForExistence(timeout: 20))
        tapTab(1)
        let menu = app.buttons.matching(identifier: "regionMenu").firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 15))
        menu.tap()
        let item = app.buttons.matching(identifier: "region_华语").firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 5), "region items in the menu should be reachable by identifier")
        item.tap()
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
    }

    /// Tab titles in English and Chinese, in tab order.
    private static let tabTitles = [["Home", "首页"], ["Categories", "分类"], ["Favorites", "收藏"],
                                    ["Downloads", "下载"], ["Me", "我的"]]

    /// A tab by title: the bottom tab bar on iPhone, the top tab bar (plain buttons) on iPad.
    private func tab(_ index: Int) -> XCUIElement {
        let titles = Self.tabTitles[index]
        let inBar = app.tabBars.buttons.matching(NSPredicate(format: "label IN %@", titles)).firstMatch
        return inBar.exists ? inBar : app.buttons.matching(NSPredicate(format: "label IN %@", titles)).firstMatch
    }

    private func tapTab(_ index: Int) {
        let target = tab(index)
        if target.waitForExistence(timeout: 3) { target.tap() }
    }

    private func shot(_ name: String, dir: String, prefix: String) {
        // The whole screen: an app screenshot of a landscape iPad comes back cropped.
        let data = XCUIScreen.main.screenshot().pngRepresentation
        let url = URL(fileURLWithPath: dir).appendingPathComponent("\(prefix)-\(name).png")
        try? data.write(to: url)
    }
}
