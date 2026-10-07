#if os(iOS)
import SwiftUI

/// Source, line, and skip settings as one group of standard rows. Its own view, so the controls and
/// the playback ticks never re-render it.
///
/// 视频源, 线路与跳过设置, 作为一组标准行展示. 作为独立视图, 控制层与播放进度更新不会让它重新渲染.
struct PlayerSettingsSection: View {
    let vm: PlayerViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            SectionHeader(Text("Playback"))
            VStack(spacing: 0) {
                sourceRow
                rowDivider
                if vm.allLines.count > 1 {
                    lineRow
                    rowDivider
                }
                skipRow(title: "Skip Intro", seconds: vm.skipIntroSeconds) { vm.updateSkipIntro($0) }
                rowDivider
                skipRow(title: "Skip Outro", seconds: vm.skipOutroSeconds) { vm.updateSkipOutro($0) }
            }
            .raisedSurface()
        }
    }

    private var rowDivider: some View {
        Divider().padding(.leading, Spacing.lg)
    }

    @ViewBuilder
    private var sourceRow: some View {
        let current = vm.sources.first { $0.sourceKey == vm.currentSourceKey }
        let value = HStack(spacing: Spacing.xs + 2) {
            Text(DisplayFormatters.cleanSourceName(vm.currentSourceName))
                .lineLimit(1)
            if let current, current.durationMs > 0 {
                Text(DisplayFormatters.latency(current.durationMs))
                    .font(AppFont.footnote.monospacedDigit())
                    .foregroundStyle(StatusColor.success)
            }
        }
        if vm.sources.count > 1 {
            Menu {
                ForEach(vm.sources) { source in
                    Button {
                        guard source.sourceKey != vm.currentSourceKey else { return }
                        vm.selectSource(source.sourceKey, autoplay: true)
                    } label: {
                        if source.sourceKey == vm.currentSourceKey {
                            Label(DisplayFormatters.cleanSourceName(source.sourceName), systemImage: "checkmark")
                        } else {
                            Text(DisplayFormatters.cleanSourceName(source.sourceName))
                        }
                        if source.durationMs > 0 {
                            Text(DisplayFormatters.latency(source.durationMs))
                        }
                    }
                }
            } label: {
                settingRow(title: "Source", chevron: true) { value }
            }
            .tint(.primary)
            .accessibilityIdentifier("sourceMenu")
        } else {
            settingRow(title: "Source", chevron: false) { value }
        }
    }

    private var lineRow: some View {
        Menu {
            ForEach(0..<vm.allLines.count, id: \.self) { index in
                let isDead = vm.allLines[index].isEmpty
                Button {
                    guard index != vm.currentLineIndex else { return }
                    vm.switchLine(index)
                } label: {
                    if index == vm.currentLineIndex {
                        Label("Line \(index + 1)", systemImage: "checkmark")
                    } else {
                        Text("Line \(index + 1)")
                    }
                    if isDead { Text("Unavailable") }
                }
                .disabled(isDead)
            }
        } label: {
            settingRow(title: "Line", chevron: true) { Text("Line \(vm.currentLineIndex + 1)") }
        }
        .tint(.primary)
        .accessibilityIdentifier("lineMenu")
    }

    private func skipRow(title: LocalizedStringKey, seconds: Int, onChange: @escaping (Int) -> Void) -> some View {
        Stepper(value: Binding(get: { seconds }, set: { onChange(max(0, min(300, $0))) }), in: 0...300, step: 5) {
            HStack {
                Text(title)
                    .foregroundStyle(.primary)
                Spacer()
                Text(seconds == 0 ? String(localized: "Off") : String(localized: "\(seconds) s"))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
        }
        .font(AppFont.body)
        .padding(.horizontal, Spacing.lg)
        .frame(minHeight: 48)
    }

    /// A standard 17 pt settings row: title on the left, value and an optional menu chevron on the right.
    ///
    /// 标准 17 pt 设置行: 左侧标题, 右侧数值与可选的菜单箭头.
    private func settingRow<Value: View>(title: LocalizedStringKey, chevron: Bool,
                                         @ViewBuilder value: () -> Value) -> some View {
        HStack(spacing: Spacing.sm) {
            Text(title)
                .foregroundStyle(.primary)
            Spacer(minLength: Spacing.md)
            value()
                .foregroundStyle(.secondary)
            if chevron {
                Image(systemName: "chevron.up.chevron.down")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
        }
        .font(AppFont.body)
        .padding(.horizontal, Spacing.lg)
        .frame(minHeight: 48)
        .contentShape(Rectangle())
    }
}
#endif
