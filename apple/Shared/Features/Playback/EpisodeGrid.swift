import SwiftUI

struct EpisodeGrid: View {
    let episodes: [Episode]
    let currentIndex: Int
    let onSelect: (Int) -> Void

    private var minItemWidth: CGFloat {
        let longest = episodes.map(\.name).max(by: { $0.count < $1.count }) ?? ""
        // Estimate width: CJK chars ~11pt, ASCII ~7pt at caption2 size, plus 16pt horizontal padding.
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
                }
                .buttonStyle(.plain)
            }
        }
    }
}
