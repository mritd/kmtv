import SwiftUI
import Kingfisher

#if os(iOS)
/// Stand-in for missing or failed artwork: the title's first character in the accent color
/// over a neutral fill, with a film glyph.
///
/// 封面缺失或加载失败时的占位: 中性底色上用强调色显示片名首字, 并带胶片图标.
struct PosterPlaceholder: View {
    let title: String
    var compact = false
    @Environment(\.appTheme) private var theme

    var body: some View {
        ZStack {
            Surface.fill
            VStack(spacing: compact ? 2 : 6) {
                if let initial = title.trimmingCharacters(in: .whitespacesAndNewlines).first {
                    Text(String(initial))
                        .font(compact ? .title3.bold() : .largeTitle.bold())
                        .foregroundStyle(theme.accent)
                }
                if !compact {
                    Image(systemName: "film")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityHidden(true)
    }
}

/// Remote artwork that falls back to `PosterPlaceholder` while loading and on failure. When `url`
/// fails and the environment's `CoverRegistry` knows another cover for `title`, it loads that one
/// instead; without a registry (previews, the unit test host) it only shows `url`.
/// The caller sets the frame or aspect ratio and applies `artworkFrame`. Blurred backdrops pass
/// `showsPlaceholder: false`, since a blurred placeholder glyph reads as a stray square.
///
/// 远程图片, 加载中与加载失败时显示 `PosterPlaceholder`. `url` 加载失败且环境中的 `CoverRegistry` 有
/// `title` 的其他封面时, 改为加载该封面; 没有登记表时 (预览, 单元测试宿主) 只显示 `url`. 由调用方设置尺寸或宽高比并应用 `artworkFrame`.
/// 模糊背景传入 `showsPlaceholder: false`, 因为模糊后的占位字形看起来像一个多余的方块.
struct ArtworkImage: View {
    let url: URL?
    let title: String
    var compactPlaceholder = false
    var showsPlaceholder = true
    // URLs that failed for this view; each is tried once, so two failing covers never alternate.
    //
    // 在本视图中加载失败的 URL; 每个只尝试一次, 两个都失败的封面不会来回重试.
    @State private var failed: Set<URL> = []
    @Environment(CoverRegistry.self) private var covers: CoverRegistry?

    var body: some View {
        Group {
            if let shown = shownURL {
                KFImage(shown)
                    .placeholder { placeholder }
                    .onFailure { error in
                        Task { @MainActor in
                            if case .responseError(reason: .invalidHTTPStatusCode(let response)) = error {
                                covers?.markBroken(shown, status: response.statusCode)
                            }
                            failed.insert(shown)
                        }
                    }
                    .fade(duration: 0.2)
                    .resizable()
                    .scaledToFill()
            } else {
                placeholder
            }
        }
        .onChange(of: url) { _, _ in failed = [] }
    }

    @ViewBuilder
    private var placeholder: some View {
        if showsPlaceholder {
            PosterPlaceholder(title: title, compact: compactPlaceholder)
        } else {
            Color.clear
        }
    }

    /// `url`, then the registered cover, skipping any that failed here or are known broken.
    ///
    /// 依次为 `url` 与已登记的封面, 跳过在此处失败过或已知失效的.
    private var shownURL: URL? {
        [url, covers?.cover(for: title)].compactMap { $0 }
            .first { !failed.contains($0) && covers?.isBroken($0) != true }
    }
}

/// A thin accent progress bar laid along the bottom edge of artwork.
///
/// 贴在图片底边的细强调色进度条.
struct ArtworkProgressBar: View {
    let fraction: Double
    @Environment(\.appTheme) private var theme

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Rectangle().fill(.black.opacity(0.3))
                Rectangle().fill(theme.accent)
                    .frame(width: geo.size.width * min(max(fraction, 0), 1))
            }
        }
        .frame(height: 4)
        .accessibilityHidden(true)
    }
}

/// A section title with an optional trailing action.
///
/// 区块标题, 可带右侧操作.
struct SectionHeader<Trailing: View>: View {
    let title: Text
    @ViewBuilder var trailing: () -> Trailing

    init(_ title: Text, @ViewBuilder trailing: @escaping () -> Trailing) {
        self.title = title
        self.trailing = trailing
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            title
                .font(AppFont.section)
                .foregroundStyle(.primary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: Spacing.sm)
            trailing()
                .font(AppFont.secondary)
        }
    }
}

extension SectionHeader where Trailing == EmptyView {
    init(_ title: Text) {
        self.init(title) { EmptyView() }
    }
}
/// The app's mark: a "K" on an accent-filled rounded square, following the chosen theme.
///
/// App 标识: 强调色圆角方块上的 "K", 跟随所选主题.
struct AppMark: View {
    let size: CGFloat
    @Environment(\.appTheme) private var theme

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.24, style: .continuous)
            .fill(theme.accent)
            .frame(width: size, height: size)
            .overlay {
                Text(verbatim: "K")
                    .font(.system(size: size * 0.46, weight: .heavy, design: .rounded))
                    .foregroundStyle(theme.onAccent)
            }
            .shadow(color: theme.accent.opacity(0.35), radius: size * 0.18, y: size * 0.06)
            .accessibilityHidden(true)
    }
}
#endif
