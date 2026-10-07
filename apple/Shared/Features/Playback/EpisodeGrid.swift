import SwiftUI

/// Download marker on an episode button.
///
/// 剧集按钮上的下载标记.
enum EpisodeDownloadBadge: Equatable {
    case downloaded
    case downloading(Double)
    case queued
}

#if os(iOS)
/// The player's episode chips. Download state shows as a glyph before the name, so it never
/// covers the label or gets clipped at the chip edge.
///
/// 播放页的选集 chip. 下载状态以图标形式显示在名称之前, 不会遮挡文字或被 chip 边缘裁切.
struct EpisodeGrid: View {
    let episodes: [Episode]
    let currentIndex: Int
    var badges: [Int: EpisodeDownloadBadge] = [:]
    let onSelect: (Int) -> Void

    @ScaledMetric(relativeTo: .subheadline) private var cjkWidth: CGFloat = 15
    @ScaledMetric(relativeTo: .subheadline) private var asciiWidth: CGFloat = 8.5

    private var minItemWidth: CGFloat {
        let longest = episodes.map(\.name).max(by: { $0.count < $1.count }) ?? ""
        // Estimate the label width at the chip font, plus padding and room for a badge glyph.
        //
        // 按 chip 字号估算文字宽度, 另加内边距与下载图标的空间.
        let width = longest.reduce(CGFloat(0)) { sum, char in
            sum + (char.isASCII ? asciiWidth : cjkWidth)
        } + 30
        return max(72, min(width, 260))
    }

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: minItemWidth), spacing: Spacing.sm)], spacing: Spacing.sm) {
            ForEach(Array(episodes.enumerated()), id: \.offset) { index, ep in
                let isCurrent = index == currentIndex
                Button {
                    onSelect(index)
                } label: {
                    HStack(spacing: Spacing.xs) {
                        badge(for: index)
                        Text(ep.name)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.chip(selected: isCurrent, minHeight: 42))
                .accessibilityAddTraits(isCurrent ? .isSelected : [])
                .accessibilityValue(accessibilityState(for: index))
            }
        }
    }

    @ViewBuilder
    private func badge(for index: Int) -> some View {
        switch badges[index] {
        case .downloaded:
            Image(systemName: "arrow.down.circle.fill")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(index == currentIndex ? AnyShapeStyle(.primary) : AnyShapeStyle(.tint))
        case .downloading(let progress):
            Circle()
                .trim(from: 0, to: max(0.05, progress))
                .stroke(.tint, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .frame(width: 10, height: 10)
        case .queued:
            Image(systemName: "clock")
                .font(.caption2)
                .foregroundStyle(.secondary)
        case nil:
            EmptyView()
        }
    }

    private func accessibilityState(for index: Int) -> Text {
        switch badges[index] {
        case .downloaded: Text("Downloaded")
        case .downloading: Text("Downloading")
        case .queued: Text("Queued")
        case nil: Text(verbatim: "")
        }
    }
}
#endif
