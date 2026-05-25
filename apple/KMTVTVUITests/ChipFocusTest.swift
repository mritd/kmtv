import XCTest

@MainActor
final class ChipFocusTest: XCTestCase {
    private let app = XCUIApplication()
    private let remote = XCUIRemote.shared

    private func save(_ name: String) {
        let screenshot = app.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.lifetime = .keepAlways
        attachment.name = name
        add(attachment)
        let path = "/tmp/tvos-screenshots/chip_\(name).png"
        try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: path))
    }

    func testChipFocusBorder() throws {
        app.launch()
        sleep(5)

        // Navigate to Categories tab
        remote.press(.up)
        sleep(1)
        remote.press(.right)
        sleep(1)
        remote.press(.select)
        sleep(3)
        save("01_categories_loaded")

        // Focus on main tabs
        remote.press(.down)
        sleep(1)
        save("02_main_tab_focused")

        // Move right through tabs
        remote.press(.right)
        sleep(1)
        save("03_tab_right1")

        // Move down to subcategory chips
        remote.press(.down)
        sleep(1)
        save("04_subcategory_chip")

        // Move right through chips
        remote.press(.right)
        sleep(1)
        save("05_chip_right1")

        remote.press(.right)
        sleep(1)
        save("06_chip_right2")

        // Move down to region chips
        remote.press(.down)
        sleep(1)
        save("07_region_chip")

        remote.press(.right)
        sleep(1)
        save("08_region_right1")
    }
}
