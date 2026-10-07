import SwiftUI

#if os(iOS)
/// The iOS type scale. Every text style in the app comes from here, so sizes follow Dynamic Type
/// and pages never mix ad hoc sizes.
///
/// iOS 字号阶梯. App 中所有文字样式都取自这里, 因此字号跟随 Dynamic Type, 页面不会混用临时字号.
enum AppFont {
    /// Tab root titles.
    ///
    /// Tab 根页面标题.
    static let display = Font.largeTitle.bold()
    /// Player and hero titles.
    ///
    /// 播放页与 hero 标题.
    static let title = Font.title2.bold()
    /// Section headers.
    ///
    /// 区块标题.
    static let section = Font.title3.weight(.semibold)
    /// List rows, row buttons, and settings.
    ///
    /// 列表行, 行内按钮与设置项.
    static let body = Font.body
    /// Body text with emphasis, such as row titles in rich rows.
    ///
    /// 带强调的正文, 例如富内容行的标题.
    static let bodyEmphasis = Font.body.weight(.semibold)
    /// Meta lines, descriptions, chips, and pill buttons.
    ///
    /// 元信息, 简介, chip 与胶囊按钮.
    static let secondary = Font.subheadline
    /// Pill and chip labels.
    ///
    /// 胶囊按钮与 chip 文字.
    static let control = Font.subheadline.weight(.medium)
    /// Poster titles, footers, and badges.
    ///
    /// 海报标题, 脚注与角标.
    static let caption = Font.footnote.weight(.medium)
    /// Footnotes without emphasis.
    ///
    /// 不带强调的脚注.
    static let footnote = Font.footnote
    /// Poster subtitles such as the year or progress.
    ///
    /// 海报副标题, 例如年份或进度.
    static let meta = Font.caption
}

/// Spacing scale in points.
///
/// 间距阶梯 (pt).
enum Spacing {
    static let xxs: CGFloat = 2
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 32
    /// Horizontal page margin.
    ///
    /// 页面水平边距.
    static let page: CGFloat = 16
    /// Vertical gap between page sections.
    ///
    /// 页面区块之间的垂直间距.
    static let section: CGFloat = 28
}

/// Sizes of media screens (posters, shelves, grids, hero) that grow on regular-width screens,
/// iPad full screen or a wide split, so artwork keeps its weight there; phones keep the compact values.
///
/// 媒体页面 (海报, 横向列表, 网格, hero) 的尺寸, 在 regular 宽度 (iPad 全屏或较宽的分屏) 下放大, 使图片
/// 在大屏上依然有分量; 手机保持紧凑尺寸.
struct MediaMetrics {
    let regular: Bool

    init(_ sizeClass: UserInterfaceSizeClass?) {
        regular = sizeClass == .regular
    }

    /// Poster width in shelves.
    ///
    /// 横向列表中的海报宽度.
    var cardWidth: CGFloat { regular ? 156 : 116 }
    /// Smallest poster width in adaptive grids.
    ///
    /// 自适应网格中海报的最小宽度.
    var gridMinimum: CGFloat { regular ? 150 : 104 }
    /// Largest poster width in adaptive grids.
    ///
    /// 自适应网格中海报的最大宽度.
    var gridMaximum: CGFloat { regular ? 210 : 180 }
    /// Gap between posters.
    ///
    /// 海报之间的间距.
    var posterSpacing: CGFloat { regular ? Spacing.lg : Spacing.md }

    /// Hero height for a hero `width`: fixed on phones, about 30% of the width on iPad, so a wide
    /// hero is not cut down to a strip.
    ///
    /// 给定 hero 宽度 `width` 时的 hero 高度: 手机上固定; iPad 上约为宽度的 30%, 宽 hero 因此不会被裁成细条.
    func heroHeight(width: CGFloat) -> CGFloat {
        regular ? min(max(width * 0.3, 260), 380) : 214
    }
}

/// Layout widths for regular-width screens.
///
/// regular 宽度屏幕的布局宽度.
enum PageLayout {
    /// Column width of settings-like screens (lists and forms) on iPad, as in the system Settings.
    ///
    /// iPad 上设置类页面 (列表与表单) 的栏宽, 与系统设置一致.
    static let readableWidth: CGFloat = 720
}

/// Corner radius scale in points.
///
/// 圆角阶梯 (pt).
enum Radius {
    /// Badges.
    ///
    /// 角标.
    static let xs: CGFloat = 4
    /// Episode chips and thumbnails.
    ///
    /// 选集 chip 与缩略图.
    static let sm: CGFloat = 8
    /// Posters.
    ///
    /// 海报.
    static let md: CGFloat = 12
    /// Hero cards and grouped surfaces.
    ///
    /// Hero 卡片与分组表面.
    static let lg: CGFloat = 16
}

/// Semantic surfaces. They are the system grouped colors, so custom pages match native lists.
///
/// 语义表面色. 直接使用系统分组色, 让自绘页面与原生列表一致.
enum Surface {
    /// Page background.
    ///
    /// 页面背景.
    static let canvas = Color(uiColor: .systemGroupedBackground)
    /// Cards and grouped sections on the canvas.
    ///
    /// 位于页面背景上的卡片与分组.
    static let raised = Color(uiColor: .secondarySystemGroupedBackground)
    /// Controls drawn on the canvas: chips, pill buttons, placeholders.
    ///
    /// 绘制在页面背景上的控件: chip, 胶囊按钮, 占位图.
    static let fill = Color(uiColor: .tertiarySystemFill)
    /// Controls drawn on a raised surface.
    ///
    /// 绘制在卡片表面上的控件.
    static let raisedFill = Color(uiColor: .quaternarySystemFill)
    static let separator = Color(uiColor: .separator)
    /// Hairline outline around artwork, so light posters keep their edge.
    ///
    /// 图片周围的细描边, 让浅色海报保持边缘.
    static let artworkOutline = Color(light: .black.opacity(0.08), dark: .white.opacity(0.08))
    /// Shadow under raised surfaces; light mode only, dark mode relies on the color step.
    ///
    /// 卡片表面下的阴影; 仅浅色模式使用, 深色模式依赖色阶.
    static let shadow = Color(light: .black.opacity(0.08), dark: .clear)
    /// Scrim under text drawn on artwork.
    ///
    /// 图片上文字下方的遮罩.
    static let scrim = Color.black.opacity(0.62)
}

/// The iPad page layout of lists and forms: shows the title inline, since the top tab bar already
/// names the page, and centers the scroll content in a `maxWidth` column, or keeps it full width when
/// `maxWidth` is nil. Compact widths are untouched.
///
/// iPad 上列表与表单的页面布局: 以行内方式显示标题, 因为顶部标签栏已标明当前页面; 并将滚动内容居中放在
/// `maxWidth` 宽的栏中, `maxWidth` 为 nil 时保持全宽. compact 宽度不受影响.
private struct RegularPage: ViewModifier {
    let maxWidth: CGFloat?
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var width: CGFloat = 0

    func body(content: Content) -> some View {
        let regular = sizeClass == .regular
        // nil keeps the system margin.
        //
        // nil 表示保留系统边距.
        let inset: CGFloat? = if regular, let maxWidth { max(Spacing.page, (width - maxWidth) / 2) } else { nil }
        content
            .contentMargins(.horizontal, inset, for: .scrollContent)
            .navigationBarTitleDisplayMode(regular ? .inline : .automatic)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }
}

extension View {
    /// See `RegularPage`; forms default to `PageLayout.readableWidth`.
    ///
    /// 参见 `RegularPage`; 表单默认使用 `PageLayout.readableWidth`.
    func readableColumn(maxWidth: CGFloat? = PageLayout.readableWidth) -> some View {
        modifier(RegularPage(maxWidth: maxWidth))
    }

    /// Draws the view as a raised grouped surface: system surface color, large radius, light shadow.
    ///
    /// 将视图绘制为分组卡片表面: 系统表面色, 大圆角, 浅阴影.
    func raisedSurface(radius: CGFloat = Radius.lg) -> some View {
        background(Surface.raised, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .shadow(color: Surface.shadow, radius: 1.5, y: 1)
    }

    /// Draws a text field as a 48 pt raised box; `invalid` outlines it in red.
    ///
    /// 将文本框绘制为 48 pt 的卡片表面输入框; `invalid` 时显示红色描边.
    func fieldSurface(invalid: Bool = false) -> some View {
        font(AppFont.body)
            .padding(.horizontal, 14)
            .frame(minHeight: 48)
            .background(Surface.raised, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                    .strokeBorder(invalid ? StatusColor.danger : Surface.separator.opacity(0.6), lineWidth: invalid ? 1.5 : 0.5)
            }
    }

    /// Clips artwork to `radius` and adds the hairline outline.
    ///
    /// 将图片裁切为 `radius` 圆角并加上细描边.
    func artworkFrame(radius: CGFloat = Radius.md) -> some View {
        clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(Surface.artworkOutline, lineWidth: 1)
            }
    }
}
#endif

/// Semantic status colors, shared by iOS and tvOS, so success, caution, warning, and failure read
/// the same on every screen. They are the system colors the screens used before.
///
/// 语义状态色, iOS 与 tvOS 共用, 使成功, 提醒, 警告与失败在各页面中含义一致. 取值即各页面此前使用的
/// 系统颜色.
enum StatusColor {
    /// Done, healthy, or fast.
    ///
    /// 已完成, 健康或速度快.
    static let success = Color.green
    /// Slower than expected, but working.
    ///
    /// 比预期慢, 但仍可用.
    static let caution = Color.yellow
    /// Needs attention: offline, incompatible, or slow.
    ///
    /// 需要注意: 离线, 不兼容或速度慢.
    static let warning = Color.orange
    /// Failed, invalid, destructive, or restricted content.
    ///
    /// 失败, 无效, 破坏性操作或受限内容.
    static let danger = Color.red
}
