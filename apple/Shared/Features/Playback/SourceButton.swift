#if os(tvOS)
import SwiftUI

/// Source button of the tvOS detail page's source grid, with the source's latency.
///
/// tvOS 详情页视频源网格中的视频源按钮, 附带该视频源的延迟.
struct SourceButton: View {
    let source: SourceResult
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            label
        }
        .buttonStyle(.tvPlain)
    }

    private var label: some View {
        TVSourceButtonLabel(
            name: DisplayFormatters.cleanSourceName(source.sourceName),
            durationMs: source.durationMs,
            isSelected: isSelected
        )
    }
}

/// tvOS label keeps focus, selected state, and latency in one stable view tree.
///
/// tvOS 标签把焦点, 选中态和延迟保持在稳定视图树中.
private struct TVSourceButtonLabel: View {
    let name: String
    let durationMs: Double
    let isSelected: Bool

    var body: some View {
        VStack(spacing: TVSpacing.hairline) {
            Text(name)
                .font(.caption)
                .lineLimit(1)
            if durationMs > 0 {
                Text(DisplayFormatters.latency(durationMs))
                    .font(.caption2)
                    .foregroundStyle(latencyColor)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity)
        .tvFocusableLabel(selected: isSelected)
    }

    private var latencyColor: Color {
        if durationMs < 1000 { return StatusColor.success }
        if durationMs < 3000 { return StatusColor.caution }
        return StatusColor.warning
    }
}
#endif
