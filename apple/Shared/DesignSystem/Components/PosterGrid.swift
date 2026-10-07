import SwiftUI
import SkeletonUI

/// The poster grid of the browsing screens: adaptive `MediaMetrics` columns on iOS, five fixed
/// columns on tvOS. The caller adds the padding, since each screen sits the grid differently.
///
/// 浏览类页面的海报网格: iOS 上为按 `MediaMetrics` 自适应的列, tvOS 上为固定五列. 内边距由调用方添加,
/// 因为各页面放置网格的方式不同.
struct PosterGrid<Content: View>: View {
    @ViewBuilder let content: () -> Content
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    var body: some View {
        #if os(iOS)
        let metrics = MediaMetrics(sizeClass)
        LazyVGrid(columns: [GridItem(.adaptive(minimum: metrics.gridMinimum, maximum: metrics.gridMaximum),
                                     spacing: metrics.posterSpacing)],
                  spacing: metrics.posterSpacing) {
            content()
        }
        #else
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: TVSpacing.grid), count: TVMetrics.gridColumns),
                  spacing: TVSpacing.grid) {
            content()
        }
        #endif
    }
}

/// A loading poster: a 2:3 artwork block and a title line, plus a short meta line when
/// `showsMeta`. With a `width` it has a fixed size, as in shelves; without one it fills its grid
/// cell.
///
/// 加载中的海报: 2:3 的图片块与一条标题线, `showsMeta` 时再加一条短的元信息线. 指定 `width` 时为固定尺寸
/// (用于横向列表); 未指定时填满网格单元.
struct PosterSkeleton: View {
    var width: CGFloat?
    var showsMeta = false

    #if os(iOS)
    private let radius = Radius.md
    private let spacing: CGFloat = 6
    #else
    private let radius = TVRadius.placeholder
    private let spacing = TVSpacing.xs
    #endif
    /// Corner radius of the text lines.
    ///
    /// 文字线条的圆角.
    private let lineRadius: CGFloat = 3

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) {
            artwork
            line
                .frame(width: width.map { $0 * 0.7 }, height: 12)
            if showsMeta {
                line
                    .frame(width: 40, height: 10)
            }
        }
    }

    @ViewBuilder
    private var artwork: some View {
        let block = RoundedRectangle(cornerRadius: radius)
            .skeleton(with: true, shape: .rounded(.radius(radius, style: .continuous)))
        if let width {
            block.frame(width: width, height: width * 1.5)
        } else {
            block.aspectRatio(2/3, contentMode: .fit)
        }
    }

    private var line: some View {
        RoundedRectangle(cornerRadius: lineRadius)
            .skeleton(with: true, shape: .rounded(.radius(lineRadius, style: .continuous)))
    }
}

/// A `PosterGrid` of `count` loading posters.
///
/// 由 `count` 个加载中海报组成的 `PosterGrid`.
struct PosterSkeletonGrid: View {
    let count: Int
    var showsMeta = false

    var body: some View {
        PosterGrid {
            ForEach(0..<count, id: \.self) { _ in
                PosterSkeleton(showsMeta: showsMeta)
            }
        }
    }
}
