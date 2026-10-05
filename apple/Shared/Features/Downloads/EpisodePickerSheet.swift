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
            case .downloading(let progress): result[ep.episodeIndex] = .downloading(progress)
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
    @State private var selected: Set<Int> = []

    private var selectable: [Int] { episodes.indices.filter { badges[$0] == nil } }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(DisplayFormatters.metaLine([title, sourceName], separator: " · "))
                        .font(.caption)
                        .foregroundStyle(Theme.textSecondary)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 76), spacing: 10)], spacing: 10) {
                        ForEach(episodes.indices, id: \.self) { index in cell(index) }
                    }
                }
                .padding()
            }
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
        .presentationDetents([.medium, .large])
    }

    private func cell(_ index: Int) -> some View {
        let badge = badges[index]
        let isSelected = selected.contains(index)
        return Button {
            guard badge == nil else { return }
            if isSelected { selected.remove(index) } else { selected.insert(index) }
        } label: {
            VStack(spacing: 3) {
                Text(episodes[index].name).font(.footnote).lineLimit(1)
                Group {
                    switch badge {
                    case .downloaded: Text("Downloaded").foregroundStyle(.green)
                    case .downloading: Text("Downloading").foregroundStyle(Theme.accent)
                    case .queued: Text("Waiting").foregroundStyle(Theme.textSecondary)
                    case nil:
                        if let source = hints[index] {
                            Text("From \(source)").foregroundStyle(Theme.textSecondary)
                        } else if isSelected {
                            Text("Selected").foregroundStyle(Theme.accent)
                        } else {
                            Text(" ")
                        }
                    }
                }
                .font(.caption2)
                .lineLimit(1)
            }
            .frame(maxWidth: .infinity, minHeight: 52)
            .padding(.horizontal, 4)
            .background(isSelected ? Theme.accent.opacity(0.18) : Theme.bgCard)
            .overlay(RoundedRectangle(cornerRadius: 8)
                .strokeBorder(isSelected ? Theme.accent : .clear, lineWidth: 1.5))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .opacity(badge == nil ? 1 : 0.55)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var footer: some View {
        VStack(spacing: 8) {
            HStack {
                Text(allowsCellular ? "Downloads over cellular allowed" : "WiFi only · change in Me")
                Spacer()
                Text("Free \(DownloadFormatting.bytes(freeSpace))")
            }
            .font(.caption)
            .foregroundStyle(Theme.textSecondary)
            Button {
                onDownload(selected.sorted())
                dismiss()
            } label: {
                Text(selected.isEmpty ? String(localized: "Select episodes to download")
                     : String(localized: "Download \(selected.count) episodes"))
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .disabled(selected.isEmpty)
        }
        .padding()
        .background(.bar)
    }
}

/// Download rows of one show and the badges of one source and video, captured when the manager's
/// display revision changes rather than read while rendering.
///
/// 某部剧的下载数据行, 以及某个来源与视频的角标; 在管理器的展示版本变化时捕获, 而不是在渲染时读取.
struct DownloadBadgeSnapshot: Equatable {
    var badges: [Int: EpisodeDownloadBadge] = [:]
    var episodes: [DownloadEpisode] = []
}

/// Hands its content a `DownloadBadgeSnapshot` that refreshes on structural changes and throttled
/// progress only. The snapshot is computed in `onChange`, outside body evaluation, so this view
/// does not observe the rows' per-entry progress, and its content re-renders at most about twice
/// a second while downloads run.
///
/// 向内容提供一个 `DownloadBadgeSnapshot`, 它只在结构变化与节流后的进度通知时刷新. 快照在 `onChange`
/// 中计算, 不在 body 求值期间, 因此本视图不会观察数据行逐条目的进度, 下载进行时其内容每秒至多重新
/// 渲染约两次.
struct DownloadBadgesReader<Content: View>: View {
    let downloads: DownloadManager
    let title: String
    let sourceKey: String
    let videoId: String
    @ViewBuilder let content: (DownloadBadgeSnapshot) -> Content
    @State private var snapshot = DownloadBadgeSnapshot()

    /// Everything the snapshot depends on.
    ///
    /// 快照所依赖的全部输入.
    private struct Inputs: Equatable {
        let revision: DownloadDisplayRevision
        let title: String
        let sourceKey: String
        let videoId: String
    }

    var body: some View {
        content(snapshot)
            .onChange(of: Inputs(revision: downloads.displayRevision, title: title, sourceKey: sourceKey, videoId: videoId),
                      initial: true) {
                let next = capture()
                if next != snapshot { snapshot = next }
            }
    }

    private func capture() -> DownloadBadgeSnapshot {
        guard let scope = downloads.activeScopeKey, !title.isEmpty else { return DownloadBadgeSnapshot() }
        let all = downloads.episodes(in: scope, showKey: normalizeSyncKey(title))
        return DownloadBadgeSnapshot(
            badges: EpisodePickerModel.badges(episodes: all, sourceKey: sourceKey, videoId: videoId,
                                              state: downloads.displayState(of:)),
            episodes: all)
    }
}
#endif
