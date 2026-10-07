#if os(iOS)
import SwiftUI

/// The admin sources tab: health summary, a check of every source, and per-source enable toggles.
///
/// 管理页的视频源标签页: 健康汇总, 检查全部视频源, 以及每个视频源的启用开关.
struct AdminSourcesTab: View {
    let vm: AdminViewModel

    var body: some View {
        List {
            Section {
                ForEach(sortedSources, id: \.id) { source in
                    sourceRow(source)
                }
            } header: {
                HStack {
                    let healthy = vm.sources.filter { $0.health == "healthy" }.count
                    Text("Healthy: \(healthy)/\(vm.sources.count)")
                        .monospacedDigit()
                    Spacer()
                    Button {
                        Task { await vm.checkAllSources() }
                    } label: {
                        if vm.isCheckingAll {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("Check All")
                        }
                    }
                    .font(AppFont.footnote.weight(.semibold))
                    .disabled(vm.isCheckingAll)
                }
                .textCase(nil)
            }
        }
    }

    /// Sort: normal sources first, adult sources below.
    ///
    /// 排序视频源: 普通源优先, 成人源靠后.
    private var sortedSources: [Source] {
        vm.sources.sorted { a, b in
            if a.isAdult != b.isAdult { return !a.isAdult }
            return a.id < b.id
        }
    }

    @ViewBuilder
    private func sourceRow(_ source: Source) -> some View {
        HStack {
            Circle()
                .fill(healthColor(source.health))
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                HStack(spacing: 6) {
                    Text(source.name).font(AppFont.body).lineLimit(1)
                    if source.isAdult {
                        NSFWBadge()
                    }
                }
                Text(source.key).font(AppFont.footnote).foregroundStyle(.secondary)
            }
            Spacer()
            Toggle("", isOn: Binding(
                get: { source.enabled },
                set: { _ in Task { await vm.toggleSourceEnabled(source) } }
            ))
            .labelsHidden()
        }
    }

    private func healthColor(_ health: String) -> Color {
        switch health {
        case "healthy": return StatusColor.success
        case "unhealthy": return StatusColor.danger
        default: return .gray
        }
    }
}
#endif
