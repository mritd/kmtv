#if os(iOS)
import SwiftUI

/// One show's downloaded episodes grouped by source, with continue, download more, per-episode
/// actions, and the offline player. The body depends only on structural changes; the header and
/// each row are their own views, so a finished entry or a saved watch position re-renders only
/// the row that shows it.
///
/// 某部剧按来源分组的已下载剧集, 提供继续观看, 下载更多, 单集操作以及离线播放器. 页面主体只依赖结构
/// 变化; 头部与每一行都是独立视图, 因此完成一个条目或保存观看位置只会重新渲染展示它的那一行.
struct DownloadShowView: View {
    let showKey: String
    let mode: DownloadsMode
    @Environment(DownloadManager.self) private var downloads
    @Environment(AppViewModel.self) private var appVM
    @Environment(\.modelContext) private var modelContext
    @State private var playing: PlayingEpisode?
    @State private var moreDestination: PlayDestination?

    /// The fullscreen offline player's view model, built once when playback is requested so
    /// re-renders of this screen never rebuild it.
    ///
    /// 全屏离线播放器的视图模型, 在请求播放时构建一次, 因此本页面重新渲染时不会重建它.
    private struct PlayingEpisode: Identifiable {
        let id = UUID()
        let viewModel: OfflinePlayerViewModel
    }

    var body: some View {
        let _ = downloads.changeCount
        if let scope = downloads.activeScopeKey, let show = downloads.show(scopeKey: scope, showKey: showKey) {
            let episodes = downloads.episodes(in: scope, showKey: showKey)
            List {
                Section {
                    DownloadShowHeader(show: show, episodes: episodes, mode: mode,
                                       play: { play($0, show: show) },
                                       downloadMore: { moreDestination = $0 })
                }
                ForEach(Dictionary(grouping: episodes, by: \.sourceKey).sorted { $0.key < $1.key }, id: \.key) { _, group in
                    Section(group.first?.sourceName ?? "") {
                        ForEach(group, id: \.episodeKey) { ep in
                            DownloadEpisodeRow(episode: ep, mode: mode) { play(ep, show: show) }
                                .swipeActions {
                                    Button("Delete", role: .destructive) { Task { await downloads.delete(ep) } }
                                }
                        }
                    }
                }
            }
            .navigationTitle(show.title)
            .navigationBarTitleDisplayMode(.inline)
            .fullScreenCover(item: $playing) { item in
                OfflinePlayerView(viewModel: item.viewModel)
            }
            // A NavigationLink inside a List row renders as a disclosure row and drops its button
            // style, so the header's button pushes the player from here.
            //
            // List 行内的 NavigationLink 会渲染为带箭头的行并丢失按钮样式, 因此头部按钮改为从这里推入
            // 播放页.
            .navigationDestination(item: $moreDestination) { PlayerView(destination: $0) }
        } else {
            ContentUnavailableView("No downloads yet", systemImage: "arrow.down.circle")
        }
    }

    private func play(_ ep: DownloadEpisode, show: DownloadShow) {
        playing = PlayingEpisode(viewModel: OfflinePlayerViewModel(
            manager: downloads, show: show, episode: ep, modelContext: modelContext,
            serverURL: appVM.serverURL, syncStore: appVM.sync?.store))
    }
}

/// Header of a show's downloads: poster, counts, size, continue, and download more.
///
/// 某部剧下载内容的头部: 海报, 数量, 大小, 继续观看与下载更多.
private struct DownloadShowHeader: View {
    let show: DownloadShow
    let episodes: [DownloadEpisode]
    let mode: DownloadsMode
    let play: (DownloadEpisode) -> Void
    let downloadMore: (PlayDestination) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            DownloadPoster(show: show, width: 84)
            VStack(alignment: .leading, spacing: 8) {
                Text(show.title).font(.title3.bold())
                Text("\(episodes.filter { $0.state == .completed }.count)/\(episodes.count) episodes · \(DownloadFormatting.bytes(episodes.reduce(0) { $0 + $1.bytes }))")
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
                // Side by side when they fit at full width, stacked otherwise; titles never wrap or
                // truncate, since a fixed-size label makes a squeezed row not fit.
                //
                // 完整宽度放得下时并排, 否则上下排列; 标题不换行也不截断, 因为固定尺寸的标签会让被挤压的
                // 一行判定为放不下.
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { actions }
                    VStack(alignment: .leading, spacing: 8) { actions }
                }
                .font(.subheadline.weight(.medium))
                .controlSize(.small)
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private var actions: some View {
        let completed = episodes.filter { $0.state == .completed }
        if let resume = completed.first(where: { !$0.finished }) ?? completed.first {
            Button {
                play(resume)
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "play.fill")
                    Text("Continue \(resume.episodeName)")
                }
                .lineLimit(1)
                .fixedSize()
            }
            .buttonStyle(.borderedProminent)
        }
        // The most recently added download names the source to continue with.
        //
        // 以最近添加的下载所在的源作为继续下载的源.
        if mode == .online, let source = episodes.max(by: { $0.createdAt < $1.createdAt }) {
            Button {
                downloadMore(PlayDestination(
                    title: show.title,
                    sources: [SourceResult(sourceKey: source.sourceKey, sourceName: source.sourceName,
                                           videoId: source.videoId, durationMs: 0, episodes: [])],
                    sourceKey: source.sourceKey, videoId: source.videoId, coverHint: show.cover))
            } label: {
                Text("Download More").lineLimit(1).fixedSize()
            }
            .buttonStyle(.bordered)
        }
    }
}

/// One downloaded episode: state, size or progress, watch position, and its tap action.
///
/// 一集已下载的剧集: 状态, 大小或进度, 观看位置及点按操作.
private struct DownloadEpisodeRow: View {
    let episode: DownloadEpisode
    let mode: DownloadsMode
    let play: () -> Void
    @Environment(DownloadManager.self) private var downloads

    var body: some View {
        let ep = episode
        let state = downloads.displayState(of: ep)
        Button {
            switch state {
            case .completed: play()
            case .paused: downloads.resume(ep)
            case .failed: downloads.retry(ep)
            default: Task { await downloads.pause(ep) }
            }
        } label: {
            HStack(spacing: 12) {
                stateIcon(state)
                VStack(alignment: .leading, spacing: 3) {
                    Text(ep.episodeName).foregroundStyle(Theme.textPrimary)
                    Text(subtitle(ep, state: state)).font(.caption).foregroundStyle(subtitleColor(state))
                    if state == .completed, ep.durationSec > 0, ep.positionSec > 0, !ep.finished {
                        ProgressView(value: min(1, ep.positionSec / ep.durationSec)).frame(maxWidth: 160)
                    }
                }
                Spacer()
                if case .failed = state {
                    Text("Retry").font(.caption.weight(.semibold)).foregroundStyle(Theme.accent)
                } else if state == .completed {
                    Image(systemName: "play.circle.fill").font(.title3).foregroundStyle(Theme.accent)
                }
            }
        }
        .disabled(mode == .offline && state != .completed)
    }

    @ViewBuilder
    private func stateIcon(_ state: DownloadDisplayState) -> some View {
        switch state {
        case .completed:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green).font(.title3)
        case .downloading(let progress):
            ProgressView(value: progress).progressViewStyle(.circular).frame(width: 24, height: 24)
        case .failed:
            Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.red).font(.title3)
        case .paused:
            Image(systemName: "pause.circle").foregroundStyle(Theme.textSecondary).font(.title3)
        default:
            Image(systemName: "circle.dashed").foregroundStyle(Theme.textSecondary).font(.title3)
        }
    }

    private func subtitle(_ ep: DownloadEpisode, state: DownloadDisplayState) -> String {
        guard state == .completed else {
            if mode == .offline { return String(localized: "Will continue when online") }
            return DownloadFormatting.text(for: state)
        }
        let size = DownloadFormatting.bytes(ep.bytes)
        if ep.finished { return "\(size) · " + String(localized: "Watched") }
        if ep.positionSec > 0 { return "\(size) · " + String(localized: "Watched to \(DownloadFormatting.duration(ep.positionSec))") }
        return size
    }

    private func subtitleColor(_ state: DownloadDisplayState) -> Color {
        switch state {
        case .failed: .red
        case .downloading, .preparing: Theme.accent
        default: Theme.textSecondary
        }
    }
}
#endif
