import SwiftUI

/// Download marker on an episode button.
///
/// 剧集按钮上的下载标记.
enum EpisodeDownloadBadge: Equatable {
    case downloaded
    case downloading(Double)
    case queued
}

struct EpisodeGrid: View {
    let episodes: [Episode]
    let currentIndex: Int
    var badges: [Int: EpisodeDownloadBadge] = [:]
    let onSelect: (Int) -> Void

    private var minItemWidth: CGFloat {
        let longest = episodes.map(\.name).max(by: { $0.count < $1.count }) ?? ""
        // Estimate width: CJK chars ~11pt, ASCII ~7pt at caption2 size, plus 16pt horizontal padding.
        //
        // 估算集数按钮宽度: caption2 下中文约 11pt, ASCII 约 7pt, 另加 16pt 横向内边距.
        let width = longest.reduce(CGFloat(0)) { sum, char in
            sum + (char.isASCII ? 7 : 11)
        } + 16
        return max(60, min(width, 200))
    }

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: minItemWidth), spacing: 6)], spacing: 6) {
            ForEach(Array(episodes.enumerated()), id: \.offset) { index, ep in
                Button {
                    onSelect(index)
                } label: {
                    Text(ep.name)
                        .font(.caption2)
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .padding(.horizontal, 6)
                        .background(index == currentIndex ? Theme.accent : Theme.bgCard)
                        .foregroundStyle(index == currentIndex ? .white : Theme.textPrimary)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .overlay(alignment: .topTrailing) { badge(for: index) }
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private func badge(for index: Int) -> some View {
        switch badges[index] {
        case .downloaded:
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(.green, Theme.bgPrimary)
                .offset(x: 4, y: -4)
        case .downloading(let progress):
            Circle()
                .trim(from: 0, to: max(0.05, progress))
                .stroke(Theme.accent, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .frame(width: 12, height: 12)
                .background(Circle().fill(Theme.bgPrimary))
                .offset(x: 4, y: -4)
        case .queued:
            Circle()
                .strokeBorder(Theme.textSecondary, style: StrokeStyle(lineWidth: 1.5, dash: [2, 2]))
                .frame(width: 12, height: 12)
                .offset(x: 4, y: -4)
        case nil:
            EmptyView()
        }
    }
}
