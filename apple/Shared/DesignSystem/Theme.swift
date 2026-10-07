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

/// tvOS colors live in `Theme`; iOS uses the semantic tokens in Tokens.swift and AppTheme.swift.
///
/// tvOS 颜色定义在 `Theme` 中; iOS 使用 Tokens.swift 与 AppTheme.swift 中的语义 token.
enum Theme {
    #if os(tvOS)
    static let bgPrimary = Color.clear
    static let bgSecondary = Color(white: 0.10)
    static let bgCard = Color(white: 0.12)
    static let accent = Color(red: 108/255, green: 159/255, blue: 255/255)
    static let textPrimary = Color(red: 232/255, green: 232/255, blue: 240/255)  // #E8E8F0
    static let textSecondary = Color(red: 160/255, green: 160/255, blue: 168/255) // #A0A0A8
    static let ratingBadgeBg = Color.black.opacity(0.7)
    #endif

    #if os(iOS)
    static let cardWidth: CGFloat = 116
    static let heroHeight: CGFloat = 214
    #else
    static let cardWidth: CGFloat = 200
    static let heroHeight: CGFloat = 400
    #endif
}
