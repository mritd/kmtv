import XCTest
import UIKit
@testable import KMTV

final class AppThemeTests: XCTestCase {
    func testUnknownStoredValuesFallBack() {
        XCTAssertEqual(AppTheme(stored: ""), .classic)
        XCTAssertEqual(AppTheme(stored: "amber"), .classic)
        XCTAssertEqual(AppTheme(stored: "aurora"), .aurora)
        XCTAssertEqual(AppearanceMode(stored: "sepia"), .system)
        XCTAssertEqual(AppearanceMode(stored: "dark"), .dark)
        XCTAssertNil(AppearanceMode.system.colorScheme)
    }

    func testAccentsAreReadableOnTheirCanvas() {
        for theme in AppTheme.allCases {
            XCTAssertGreaterThanOrEqual(contrast(theme.lightAccent, .white), 4.5, "\(theme) light accent on white")
            XCTAssertGreaterThanOrEqual(contrast(theme.darkAccent, .black), 4.5, "\(theme) dark accent on black")
            XCTAssertGreaterThanOrEqual(contrast(.white, theme.lightAccent), 4.5, "white on \(theme) light accent")
            XCTAssertGreaterThanOrEqual(contrast(theme.darkOnAccent, theme.darkAccent), 4.5,
                                        "text on \(theme) dark accent")
        }
    }

    func testDynamicAccentResolvesPerInterfaceStyle() {
        let accent = UIColor(AppTheme.terminal.accent)
        let light = accent.resolvedColor(with: UITraitCollection(userInterfaceStyle: .light))
        let dark = accent.resolvedColor(with: UITraitCollection(userInterfaceStyle: .dark))
        XCTAssertEqual(light, AppTheme.terminal.lightAccent)
        XCTAssertEqual(dark, AppTheme.terminal.darkAccent)
    }

    private func contrast(_ a: UIColor, _ b: UIColor) -> Double {
        let la = luminance(a), lb = luminance(b)
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }

    private func luminance(_ color: UIColor) -> Double {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        color.getRed(&r, green: &g, blue: &b, alpha: &a)
        func channel(_ c: CGFloat) -> Double {
            let v = Double(c)
            return v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }
}
