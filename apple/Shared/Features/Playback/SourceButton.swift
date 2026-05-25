import SwiftUI

/// Reusable playback source button shared by detail and player source pickers.
/// 详情页和播放器源选择器复用的视频源按钮.
struct SourceButton: View {
    /// Button layout variants tuned for horizontal chips and compact grids.
    /// 按钮布局变体, 分别适配横向 chip 和紧凑网格.
    enum Style {
        case bordered
        case compactGrid
    }

    let source: SourceResult
    let isSelected: Bool
    var showsLatency = true
    var style: Style = .bordered
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            label
        }
        #if os(tvOS)
        .buttonStyle(.tvPlain)
        #else
        .sourceButtonIOSStyle(style: style, isSelected: isSelected)
        #endif
    }

    @ViewBuilder
    private var label: some View {
        #if os(tvOS)
        TVSourceButtonLabel(
            name: DisplayFormatters.cleanSourceName(source.sourceName),
            durationMs: source.durationMs,
            isSelected: isSelected,
            showsLatency: showsLatency
        )
        #else
        switch style {
        case .bordered:
            Text(DisplayFormatters.cleanSourceName(source.sourceName))
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        case .compactGrid:
            VStack(spacing: 2) {
                Text(DisplayFormatters.cleanSourceName(source.sourceName))
                    .font(.caption2)
                    .lineLimit(1)
                if showsLatency && source.durationMs > 0 {
                    Text(DisplayFormatters.latency(source.durationMs))
                        .font(.caption2)
                        .foregroundStyle(isSelected ? .white.opacity(0.8) : Theme.accent)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(isSelected ? Theme.accent : Theme.bgCard)
            .foregroundStyle(compactForegroundColor)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        #endif
    }

    #if os(iOS)
    private var compactForegroundColor: Color {
        if isSelected {
            return .white
        }
        return Theme.textPrimary
    }
    #endif
}

#if os(iOS)
private extension View {
    /// Applies the iOS source button chrome without changing the shared label content.
    /// 在不改变共享标签内容的前提下应用 iOS 视频源按钮外观.
    @ViewBuilder
    func sourceButtonIOSStyle(style: SourceButton.Style, isSelected: Bool) -> some View {
        switch style {
        case .bordered:
            self
                .applyIf(isSelected) { $0.buttonStyle(.borderedProminent) }
                .applyIf(!isSelected) { $0.buttonStyle(.bordered) }
                .tint(Theme.accent)
        case .compactGrid:
            self.buttonStyle(.plain)
        }
    }
}
#endif

#if os(tvOS)
/// tvOS label keeps focus, selected state, and latency in one stable view tree.
/// tvOS 标签把焦点, 选中态和延迟保持在稳定视图树中.
private struct TVSourceButtonLabel: View {
    let name: String
    let durationMs: Double
    let isSelected: Bool
    let showsLatency: Bool
    @Environment(\.isFocused) private var isFocused

    var body: some View {
        VStack(spacing: 2) {
            Text(name)
                .font(.caption)
                .lineLimit(1)
            if showsLatency && durationMs > 0 {
                Text(DisplayFormatters.latency(durationMs))
                    .font(.caption2)
                    .foregroundStyle(latencyColor)
            }
        }
        .foregroundStyle(foregroundColor)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity)
        .background(backgroundColor)
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(borderColor, lineWidth: isFocused ? 2 : 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .scaleEffect(isFocused ? 1.05 : 1.0)
        .animation(.easeInOut(duration: 0.15), value: isFocused)
    }

    private var foregroundColor: Color {
        if isSelected { return .white }
        if isFocused { return .white }
        return Color(white: 0.7)
    }

    private var backgroundColor: Color {
        if isSelected { return Theme.accent.opacity(0.3) }
        if isFocused { return Color.white.opacity(0.15) }
        return Color(white: 0.15)
    }

    private var borderColor: Color {
        if isSelected { return Theme.accent }
        if isFocused { return Color.white.opacity(0.4) }
        return Color(white: 0.25)
    }

    private var latencyColor: Color {
        if durationMs < 1000 { return .green }
        if durationMs < 3000 { return .yellow }
        return .orange
    }
}
#endif
