import SwiftUI

#if os(iOS)
/// The color role of an `AppBadge`.
///
/// `AppBadge` 的配色角色.
enum BadgeTone {
    /// Accent text on the accent tint: a highlighted role, a latency.
    ///
    /// 强调色浅底上的强调色文字: 突出显示的角色, 延迟.
    case accent
    /// Danger text on a light danger fill: restricted content.
    ///
    /// 浅危险色底上的危险色文字: 受限内容.
    case danger
    /// Secondary text on the neutral fill.
    ///
    /// 中性填充上的次要文字.
    case neutral
    /// White text on a translucent white plate, for badges drawn over video.
    ///
    /// 半透明白色底板上的白色文字, 用于绘制在视频上的角标.
    case overlay
}

/// A small text badge: a capsule on page surfaces, a rounded plate (`.overlay`) on video. Every
/// badge in the app uses this size and type, so badges stay consistent across screens.
///
/// 小型文字角标: 在页面表面上为胶囊, 在视频上 (`.overlay`) 为圆角底板. App 中所有角标都使用这一尺寸与
/// 字号, 使各页面的角标保持一致.
struct AppBadge: View {
    private let text: Text
    let tone: BadgeTone
    @Environment(\.appTheme) private var theme

    /// A badge with localized `text`.
    ///
    /// 显示本地化文字 `text` 的角标.
    init(_ text: LocalizedStringKey, tone: BadgeTone) {
        self.text = Text(text)
        self.tone = tone
    }

    /// A badge that shows `text` as is.
    ///
    /// 原样显示 `text` 的角标.
    init(verbatim text: String, tone: BadgeTone) {
        self.text = Text(verbatim: text)
        self.tone = tone
    }

    var body: some View {
        let label = text
            .font(AppFont.meta.weight(.semibold).monospacedDigit())
            .foregroundStyle(foreground)
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 6)
            .padding(.vertical, Spacing.xxs)
        if tone == .overlay {
            label.background(fill, in: RoundedRectangle(cornerRadius: Radius.xs, style: .continuous))
        } else {
            label.background(fill, in: Capsule())
        }
    }

    private var foreground: Color {
        switch tone {
        case .accent: theme.accent
        case .danger: StatusColor.danger
        case .neutral: .secondary
        case .overlay: .white
        }
    }

    private var fill: Color {
        switch tone {
        case .accent: theme.accentTint
        case .danger: StatusColor.danger.opacity(0.15)
        case .neutral: Surface.fill
        case .overlay: .white.opacity(0.2)
        }
    }
}

/// A user's role ("Admin" or "Regular User"); admins get the accent tone.
///
/// 用户角色 ("Admin" 或 "Regular User"); 管理员使用强调色.
struct RoleBadge: View {
    let user: User

    var body: some View {
        AppBadge(verbatim: user.roleDisplayName, tone: user.isAdmin ? .accent : .neutral)
    }
}

/// Marks adult content: an adult source, or a user allowed to see it.
///
/// 标记成人内容: 成人视频源, 或允许查看成人内容的用户.
struct NSFWBadge: View {
    var body: some View {
        AppBadge("NSFW", tone: .danger)
    }
}
#endif
