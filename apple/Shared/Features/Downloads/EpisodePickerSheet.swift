#if os(iOS)
import SwiftUI

/// Pure rules behind the picker: badges for this source's downloads, and hints for episodes
/// downloaded from another source with the same episode number (the rule `matchEpisode` uses for
/// source switches).
///
/// 选集 sheet 背后的纯规则: 本源下载的角标, 以及其他源中集数相同的已下载剧集提示 (与换源时
/// `matchEpisode` 使用的规则一致).
enum EpisodePickerModel {
    /// Badges by episode index for downloads of exactly this source and video.
    ///
    /// 与当前来源和视频完全一致的下载, 按剧集序号给出的角标.
    static func badges(episodes: [DownloadEpisode], sourceKey: String, videoId: String,
                       state: (DownloadEpisode) -> DownloadDisplayState) -> [Int: EpisodeDownloadBadge] {
        var result: [Int: EpisodeDownloadBadge] = [:]
        for ep in episodes where ep.sourceKey == sourceKey && ep.videoId == videoId {
            switch state(ep) {
            case .completed: result[ep.episodeIndex] = .downloaded
            case .downloading(let progress):
                // Whole 5% steps, so a badge changes far less often than the progress tick.
                //
                // 以 5% 为步长, 角标的变化因此远少于进度通知.
                result[ep.episodeIndex] = .downloading((progress * 20).rounded(.down) / 20)
            case .queued, .preparing, .waitingNetwork, .waitingWiFi: result[ep.episodeIndex] = .queued
            case .paused, .failed: break
            }
        }
        return result
    }

    /// Source names by episode index for completed downloads from other sources whose episode
    /// name carries the same first number.
    ///
    /// 其他来源中集名首个数字相同的已完成下载, 按剧集序号给出其来源名.
    static func otherSourceHints(episodes: [Episode], downloads: [DownloadEpisode], sourceKey: String) -> [Int: String] {
        func number(_ name: String) -> String? { name.firstMatch(of: /\d+/).map { String(Int($0.output) ?? 0) } }
        var byNumber: [String: String] = [:]
        for ep in downloads where ep.sourceKey != sourceKey && ep.state == .completed {
            if let key = number(ep.episodeName) { byNumber[key] = ep.sourceName }
        }
        var result: [Int: String] = [:]
        for (index, episode) in episodes.enumerated() {
            if let key = number(episode.name), let source = byNumber[key] { result[index] = source }
        }
        return result
    }
}

/// Multi-select sheet for downloading episodes of the current source and line.
///
/// 用于下载当前来源与线路剧集的多选 sheet.
struct EpisodePickerSheet: View {
    let title: String
    let sourceName: String
    let episodes: [Episode]
    let badges: [Int: EpisodeDownloadBadge]
    let hints: [Int: String]
    let freeSpace: Int64
    let allowsCellular: Bool
    let onDownload: ([Int]) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.appTheme) private var theme
    @State private var selected: Set<Int> = []

    private var selectable: [Int] { episodes.indices.filter { badges[$0] == nil } }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.md) {
                    Text(DisplayFormatters.metaLine([title, sourceName], separator: " · "))
                        .font(AppFont.footnote)
                        .foregroundStyle(.secondary)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 76), spacing: Spacing.sm)], spacing: Spacing.sm) {
                        ForEach(episodes.indices, id: \.self) { index in cell(index) }
                    }
                }
                .padding(Spacing.page)
            }
            .background(Surface.canvas)
            .navigationTitle("Download Episodes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    let all = !selectable.isEmpty && selectable.allSatisfy(selected.contains)
                    Button(all ? "Select None" : "Select All Not Downloaded") {
                        selected = all ? [] : Set(selectable)
                    }
                    .disabled(selectable.isEmpty)
                }
            }
            .safeAreaInset(edge: .bottom) { footer }
        }
    }

    private func cell(_ index: Int) -> some View {
        let badge = badges[index]
        let isSelected = selected.contains(index)
        return Button {
            guard badge == nil else { return }
            if isSelected { selected.remove(index) } else { selected.insert(index) }
        } label: {
            VStack(spacing: Spacing.xxs + 1) {
                Text(episodes[index].name)
                    .font(AppFont.control)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Group {
                    switch badge {
                    case .downloaded: Text("Downloaded").foregroundStyle(.green)
                    case .downloading: Text("Downloading").foregroundStyle(theme.accent)
                    case .queued: Text("Waiting").foregroundStyle(.secondary)
                    case nil:
                        if let source = hints[index] {
                            Text("From \(source)").foregroundStyle(.secondary)
                        } else if isSelected {
                            Text("Selected").foregroundStyle(theme.accent)
                        } else {
                            Text(verbatim: " ")
                        }
                    }
                }
                .font(AppFont.meta)
                .lineLimit(1)
            }
            .frame(maxWidth: .infinity, minHeight: 54)
            .padding(.horizontal, Spacing.xs)
            .background(isSelected ? theme.accentTint : Surface.raised,
                        in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Radius.sm, style: .continuous)
                .strokeBorder(isSelected ? theme.accent : .clear, lineWidth: 1.5))
            .opacity(badge == nil ? 1 : 0.55)
        }
        .buttonStyle(.pressable)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var footer: some View {
        VStack(spacing: Spacing.md) {
            HStack {
                Text(allowsCellular ? "Downloads over cellular allowed" : "WiFi only · change in Me")
                Spacer()
                Text("Free \(DownloadFormatting.bytes(freeSpace))")
                    .monospacedDigit()
            }
            .font(AppFont.footnote)
            .foregroundStyle(.secondary)
            Button {
                onDownload(selected.sorted())
                dismiss()
            } label: {
                Text(selected.isEmpty ? String(localized: "Select episodes to download")
                     : String(localized: "Download \(selected.count) episodes"))
                    .font(AppFont.bodyEmphasis)
                    .frame(maxWidth: .infinity, minHeight: 50)
                    // A neutral fill until something is selected: the system disabled prominent
                    // style turns into a near-black capsule on the dark bar.
                    //
                    // 未选择时使用中性填充: 系统的禁用态醒目按钮在深色底栏上会变成近乎全黑的胶囊.
                    .foregroundStyle(selected.isEmpty ? AnyShapeStyle(.secondary) : AnyShapeStyle(theme.onAccent))
                    .background(selected.isEmpty ? AnyShapeStyle(Surface.fill) : AnyShapeStyle(theme.accent), in: Capsule())
            }
            .buttonStyle(.pressable)
            .disabled(selected.isEmpty)
        }
        .padding(.horizontal, Spacing.page)
        .padding(.vertical, Spacing.md)
        .background(.bar)
    }
}
#endif
