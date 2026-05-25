import SwiftUI

/// Compact source picker used inside the player sheet.
/// 播放器面板内使用的紧凑视频源选择器.
struct SourceSwitcher: View {
    let sources: [SourceResult]
    let currentKey: String
    let onSelect: (String) -> Void

    @State private var showAll = false

    private var displaySources: [SourceResult] {
        // Collapse long source lists to keep playback controls usable on small screens.
        // 视频源过多时先折叠展示, 避免小屏播放控制区域过高.
        if showAll || sources.count <= 6 {
            return sources
        }
        return Array(sources.prefix(6))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                ForEach(displaySources) { source in
                    SourceButton(source: source, isSelected: source.sourceKey == currentKey, style: .compactGrid) {
                        onSelect(source.sourceKey)
                    }
                }
            }

            if sources.count > 6 {
                Button {
                    withAnimation { showAll.toggle() }
                } label: {
                    Text(showAll ? "Collapse" : "Show all \(sources.count) sources")
                        .font(.caption)
                        .foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity)
                }
            }
        }
    }
}
