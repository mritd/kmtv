import SwiftUI

#if os(iOS)
extension Color {
    init(light: Color, dark: Color) {
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(dark)
                : UIColor(light)
        })
    }
}
#endif

enum Theme {
    #if os(tvOS)
    static let bgPrimary = Color.clear
    static let bgSecondary = Color(white: 0.10)
    static let bgCard = Color(white: 0.12)
    static let accent = Color(red: 108/255, green: 159/255, blue: 255/255)
    static let textPrimary = Color(red: 232/255, green: 232/255, blue: 240/255)  // #E8E8F0
    static let textSecondary = Color(red: 160/255, green: 160/255, blue: 168/255) // #A0A0A8
    static let ratingBadgeBg = Color.black.opacity(0.7)
    #else
    static let bgPrimary = Color(
        light: Color(red: 245/255, green: 245/255, blue: 247/255),
        dark: Color(red: 10/255, green: 10/255, blue: 10/255)
    )
    static let bgSecondary = Color(
        light: Color(red: 235/255, green: 235/255, blue: 239/255),
        dark: Color(red: 20/255, green: 20/255, blue: 24/255)
    )
    static let bgCard = Color(
        light: Color(red: 255/255, green: 255/255, blue: 255/255),
        dark: Color(red: 30/255, green: 30/255, blue: 38/255)
    )
    static let accent = Color(
        light: Color(red: 74/255, green: 138/255, blue: 245/255),
        dark: Color(red: 108/255, green: 159/255, blue: 255/255)
    )
    static let textPrimary = Color(
        light: Color(red: 28/255, green: 28/255, blue: 30/255),
        dark: Color(red: 232/255, green: 232/255, blue: 240/255)
    )
    static let textSecondary = Color(
        light: Color(red: 107/255, green: 107/255, blue: 111/255),
        dark: Color(red: 136/255, green: 136/255, blue: 136/255)
    )
    static let ratingBadgeBg = Color.black.opacity(0.7)
    #endif

    #if os(iOS)
    static let cardWidth: CGFloat = 110
    static let heroHeight: CGFloat = 240
    #else
    static let cardWidth: CGFloat = 200
    static let heroHeight: CGFloat = 400
    #endif
}
