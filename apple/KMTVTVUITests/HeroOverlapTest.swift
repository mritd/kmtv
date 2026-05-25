import XCTest

@MainActor
final class HeroOverlapTest: XCTestCase {
    private let app = XCUIApplication()
    private let remote = XCUIRemote.shared

    private func save(_ name: String) {
        let screenshot = app.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.lifetime = .keepAlways
        attachment.name = name
        add(attachment)
        let path = "/tmp/tvos-screenshots/hero_\(name).png"
        try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: path))
    }

    func testHeroCardOverlap() throws {
        app.launch()
        sleep(5)
        save("01_home_no_focus")

        // Focus on hero cards
        remote.press(.down)
        sleep(2)
        save("02_hero_focused_card1")

        // Move right to second hero card
        remote.press(.right)
        sleep(2)
        save("03_hero_focused_card2")

        // Move right to third hero card
        remote.press(.right)
        sleep(2)
        save("04_hero_focused_card3")

        // Move back left
        remote.press(.left)
        sleep(2)
        save("05_hero_back_card2")
    }
}
