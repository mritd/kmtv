import SwiftUI

#if os(iOS)
/// A built-in accent theme. Only the accent changes; neutrals follow the system.
///
/// 内置强调色主题. 只改变强调色; 中性色跟随系统.
enum AppTheme: String, CaseIterable, Identifiable, Sendable {
    case classic
    case aurora
    case indigo
    case terminal
    case graphite

    /// The theme used when nothing, or an unknown value, is stored.
    ///
    /// 未存储或存储了未知值时使用的主题.
    static let fallback = AppTheme.classic

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .classic: String(localized: "Classic Blue")
        case .aurora: String(localized: "Aurora")
        case .indigo: String(localized: "Indigo")
        case .terminal: String(localized: "Terminal")
        case .graphite: String(localized: "Graphite")
        }
    }

    /// Light-mode accent, at least 4.5:1 against white.
    ///
    /// 浅色模式强调色, 对白色对比度不低于 4.5:1.
    var lightAccent: UIColor {
        switch self {
        case .classic: UIColor(hex: 0x2F6BE0)
        case .aurora: UIColor(hex: 0x0A7EA4)
        case .indigo: UIColor(hex: 0x5B4FE0)
        case .terminal: UIColor(hex: 0x1A7F38)
        case .graphite: UIColor(hex: 0x1C1C1E)
        }
    }

    /// Dark-mode accent, at least 4.5:1 against black.
    ///
    /// 深色模式强调色, 对黑色对比度不低于 4.5:1.
    var darkAccent: UIColor {
        switch self {
        case .classic: UIColor(hex: 0x6EA2FF)
        case .aurora: UIColor(hex: 0x4FD8F5)
        case .indigo: UIColor(hex: 0x9D94FF)
        case .terminal: UIColor(hex: 0x5BF08A)
        case .graphite: UIColor(hex: 0xF2F2F7)
        }
    }

    /// Dark-mode text drawn on an accent fill; light mode always uses white.
    ///
    /// 深色模式下强调色填充上的文字颜色; 浅色模式始终为白色.
    var darkOnAccent: UIColor {
        switch self {
        case .classic: UIColor(hex: 0x0B1A33)
        case .aurora: UIColor(hex: 0x00222B)
        case .indigo: UIColor(hex: 0x14103A)
        case .terminal: UIColor(hex: 0x032611)
        case .graphite: UIColor(hex: 0x000000)
        }
    }

    /// The accent as a dynamic UIKit color, for window tint and UIKit-hosted controls.
    ///
    /// 动态 UIKit 强调色, 用于 window tint 以及 UIKit 承载的控件.
    var uiAccent: UIColor {
        UIColor { $0.userInterfaceStyle == .dark ? darkAccent : lightAccent }
    }

    var accent: Color { Color(uiColor: uiAccent) }

    var onAccent: Color {
        Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? darkOnAccent : .white })
    }

    /// The accent at low opacity, for selected backgrounds such as badges and avatars.
    ///
    /// 低透明度强调色, 用于角标, 头像等选中背景.
    var accentTint: Color { accent.opacity(0.14) }

    init(stored: String) {
        self = AppTheme(rawValue: stored) ?? Self.fallback
    }
}

/// The color scheme the app runs in, independent of the system setting.
///
/// App 使用的配色模式, 可独立于系统设置.
enum AppearanceMode: String, CaseIterable, Identifiable, Sendable {
    case system
    case light
    case dark

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .system: String(localized: "System")
        case .light: String(localized: "Light")
        case .dark: String(localized: "Dark")
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }

    init(stored: String) {
        self = AppearanceMode(rawValue: stored) ?? .system
    }
}

/// `UserDefaults` keys for the per-device appearance preferences; they are never synced.
///
/// 本机外观偏好在 `UserDefaults` 中的键; 这些偏好不会同步.
enum AppearanceKeys {
    static let theme = "appearance.theme"
    static let mode = "appearance.mode"
}

extension EnvironmentValues {
    /// The active accent theme, injected at the root view.
    ///
    /// 当前强调色主题, 由根视图注入.
    @Entry var appTheme: AppTheme = .fallback
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255,
                  green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255,
                  alpha: 1)
    }
}
#endif
