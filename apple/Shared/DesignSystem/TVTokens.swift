import SwiftUI

#if os(tvOS)
/// tvOS spacing in points. The tvOS counterpart of `Spacing`; colors stay in `Theme`.
///
/// tvOS 间距 (pt). 对应 iOS 的 `Spacing`; 颜色仍定义在 `Theme` 中.
enum TVSpacing {
    /// Gap between a label and its latency line inside a chip.
    ///
    /// chip 内文字与延迟行之间的间距.
    static let hairline: CGFloat = 2
    /// Gap between a poster and its skeleton title line, and inside card captions.
    ///
    /// 海报与骨架标题行之间, 以及卡片说明文字内部的间距.
    static let xs: CGFloat = 4
    /// Gap between icon and text in compact rows such as the toast, and between the hero's meta items.
    ///
    /// 紧凑行 (例如提示条) 中图标与文字的间距, 以及 hero 元信息之间的间距.
    static let sm: CGFloat = 8
    /// Gap between posters in a shelf, and vertical toast padding.
    ///
    /// 横向列表中海报之间的间距, 以及提示条的垂直内边距.
    static let shelf: CGFloat = 12
    /// Padding of captions drawn on artwork.
    ///
    /// 叠加在图片上的说明文字的内边距.
    static let caption: CGFloat = 10
    /// Horizontal toast padding.
    ///
    /// 提示条的水平内边距.
    static let md: CGFloat = 16
    /// Vertical room around shelves, so focused cards can scale without clipping.
    ///
    /// 横向列表上下留白, 使获得焦点的卡片放大时不被裁切.
    static let focusRoom: CGFloat = 20
    /// Gap between hero cards and the hero's inner padding.
    ///
    /// hero 卡片之间的间距与 hero 内边距.
    static let hero: CGFloat = 24
    /// Gap between posters in a grid.
    ///
    /// 网格中海报之间的间距.
    static let grid: CGFloat = 32
    /// Gap between page sections, and between a section header and its shelf.
    ///
    /// 页面区块之间, 以及区块标题与其内容行之间的间距.
    static let section: CGFloat = 40
    /// Horizontal page margin.
    ///
    /// 页面水平边距.
    static let page: CGFloat = 48
}

/// tvOS corner radii in points.
///
/// tvOS 圆角 (pt).
enum TVRadius {
    /// Rating badges.
    ///
    /// 评分角标.
    static let badge: CGFloat = 4
    /// Source and episode chips.
    ///
    /// 视频源与选集 chip.
    static let chip: CGFloat = 6
    /// Poster placeholders and skeletons.
    ///
    /// 海报占位与骨架.
    static let placeholder: CGFloat = 8
    /// Action buttons and the toast.
    ///
    /// 操作按钮与提示条.
    static let button: CGFloat = 10
    /// Posters.
    ///
    /// 海报.
    static let card: CGFloat = 12
    /// Hero cards.
    ///
    /// Hero 卡片.
    static let hero: CGFloat = 16
}

/// tvOS sizes of media screens.
///
/// tvOS 媒体页面的尺寸.
enum TVMetrics {
    /// Poster width in shelves.
    ///
    /// 横向列表中的海报宽度.
    static let cardWidth: CGFloat = 200
    /// Hero card width.
    ///
    /// Hero 卡片宽度.
    static let heroWidth: CGFloat = 880
    /// Hero card height.
    ///
    /// Hero 卡片高度.
    static let heroHeight: CGFloat = 400
    /// Columns of poster grids.
    ///
    /// 海报网格的列数.
    static let gridColumns = 5
}

/// tvOS surfaces drawn under content.
///
/// 绘制在内容下方的 tvOS 表面色.
enum TVSurface {
    /// Idle fill of chips and buttons.
    ///
    /// chip 与按钮未聚焦时的填充色.
    static let control = Color(white: 0.15)
    /// Base under hero artwork while it loads.
    ///
    /// hero 图片加载时的底色.
    static let heroBase = Color(white: 0.08)
    /// Placeholder of the detail page poster.
    ///
    /// 详情页海报的占位色.
    static let posterPlaceholder = Color(white: 0.2)
    /// Top of the connecting screen's gradient.
    ///
    /// 连接页渐变的顶部颜色.
    static let backdropTop = Color(red: 10/255, green: 10/255, blue: 10/255)
    /// Bottom of the connecting screen's gradient.
    ///
    /// 连接页渐变的底部颜色.
    static let backdropBottom = Color(red: 17/255, green: 17/255, blue: 40/255)
    /// Light end of the app mark's gradient, also its glow.
    ///
    /// App 标识渐变的亮端, 也用作其光晕.
    static let markLight = Color(red: 74/255, green: 62/255, blue: 127/255)
    /// Dark end of the app mark's gradient.
    ///
    /// App 标识渐变的暗端.
    static let markDark = Color(red: 26/255, green: 15/255, blue: 63/255)
}

/// Colors and motion of focusable tvOS labels (chips and buttons) in their idle, focused, and
/// selected states.
///
/// 可聚焦 tvOS 标签 (chip 与按钮) 在未聚焦, 聚焦与选中状态下的颜色与动效.
enum TVFocus {
    /// Idle text of chips.
    ///
    /// chip 未聚焦时的文字颜色.
    static let idleForeground = Color(white: 0.7)
    /// Idle text of secondary action buttons.
    ///
    /// 次要操作按钮未聚焦时的文字颜色.
    static let idleActionForeground = Color(white: 0.8)
    /// Idle outline.
    ///
    /// 未聚焦时的描边.
    static let idleBorder = Color(white: 0.25)
    /// Fill of a focused label.
    ///
    /// 聚焦标签的填充色.
    static let focusedFill = Color.white.opacity(0.15)
    /// Outline of a focused label.
    ///
    /// 聚焦标签的描边.
    static let focusedBorder = Color.white.opacity(0.4)
    /// Scale of a focused label.
    ///
    /// 聚焦标签的缩放比例.
    static let scale: CGFloat = 1.05
    /// Animation of focus changes.
    ///
    /// 焦点变化的动画.
    static let animation = Animation.easeInOut(duration: 0.15)
}

/// The focus look shared by the tvOS chips and buttons: foreground, fill, and outline per state,
/// a thicker outline and a slight scale when focused. A choice (`selected:`) highlights the
/// selected chip with the accent; an action (`primary:active:`) tints the primary or active
/// button with the accent and keeps the others neutral.
///
/// tvOS chip 与按钮共用的焦点外观: 各状态下的前景, 填充与描边, 聚焦时描边加粗并轻微放大. 选择项
/// (`selected:`) 用强调色突出选中的 chip; 操作项 (`primary:active:`) 用强调色标出主要或已激活的按钮,
/// 其余保持中性.
struct TVFocusableLabelStyle: ViewModifier {
    private enum Role {
        case choice(selected: Bool)
        case action(primary: Bool, active: Bool)
    }

    private let role: Role
    private let radius: CGFloat
    @Environment(\.isFocused) private var isFocused

    /// A selectable chip, such as a source or an episode.
    ///
    /// 可选择的 chip, 例如视频源或剧集.
    init(selected: Bool, radius: CGFloat = TVRadius.chip) {
        role = .choice(selected: selected)
        self.radius = radius
    }

    /// An action button; `primary` marks the main action and `active` a toggled one.
    ///
    /// 操作按钮; `primary` 表示主要操作, `active` 表示已开启的开关.
    init(primary: Bool, active: Bool, radius: CGFloat = TVRadius.button) {
        role = .action(primary: primary, active: active)
        self.radius = radius
    }

    func body(content: Content) -> some View {
        content
            .foregroundStyle(foreground)
            .background(fill)
            .overlay(
                RoundedRectangle(cornerRadius: radius)
                    .stroke(border, lineWidth: isFocused ? 2 : 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: radius))
            .scaleEffect(isFocused ? TVFocus.scale : 1.0)
            .animation(TVFocus.animation, value: isFocused)
    }

    private var foreground: Color {
        switch role {
        case .choice(let selected):
            if selected || isFocused { return .white }
            return TVFocus.idleForeground
        case .action(let primary, let active):
            if isFocused { return .white }
            if primary || active { return Theme.accent }
            return TVFocus.idleActionForeground
        }
    }

    private var fill: Color {
        switch role {
        case .choice(let selected):
            if selected { return Theme.accent.opacity(0.3) }
            if isFocused { return TVFocus.focusedFill }
            return TVSurface.control
        case .action(let primary, let active):
            if primary && isFocused { return Theme.accent.opacity(0.4) }
            if isFocused { return TVFocus.focusedFill }
            if primary { return Theme.accent.opacity(0.2) }
            if active { return Theme.accent.opacity(0.1) }
            return TVSurface.control
        }
    }

    private var border: Color {
        switch role {
        case .choice(let selected):
            if selected { return Theme.accent }
            if isFocused { return TVFocus.focusedBorder }
            return TVFocus.idleBorder
        case .action(let primary, let active):
            if primary || active { return Theme.accent.opacity(isFocused ? 0.8 : 0.5) }
            if isFocused { return TVFocus.focusedBorder }
            return TVFocus.idleBorder
        }
    }
}

extension View {
    /// Applies `TVFocusableLabelStyle` for a selectable chip.
    ///
    /// 以可选择 chip 的方式应用 `TVFocusableLabelStyle`.
    func tvFocusableLabel(selected: Bool, radius: CGFloat = TVRadius.chip) -> some View {
        modifier(TVFocusableLabelStyle(selected: selected, radius: radius))
    }

    /// Applies `TVFocusableLabelStyle` for an action button.
    ///
    /// 以操作按钮的方式应用 `TVFocusableLabelStyle`.
    func tvFocusableLabel(primary: Bool, active: Bool, radius: CGFloat = TVRadius.button) -> some View {
        modifier(TVFocusableLabelStyle(primary: primary, active: active, radius: radius))
    }
}
#endif
