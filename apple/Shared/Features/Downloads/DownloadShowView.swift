#if os(iOS)
import SwiftUI

/// One show's downloaded episodes from the device's library (every server and account) grouped by
/// source, with play, download more, per-episode actions, and the offline player. The body reads
/// only the manager's `librarySnapshot`, which changes with structure, fetches nothing, and never
/// reads the sync store; the header and each row are their own views, so a finished entry
/// re-renders only the row that shows it, and a saved watch position only the header.
///
/// 某部剧在本机下载库中 (涵盖所有服务器与账号) 按来源分组的已下载剧集, 提供播放, 下载更多, 单集操作
/// 以及离线播放器. 页面主体只读取管理器的 `librarySnapshot` (只随结构变化), 不做任何查询, 且从不
/// 读取同步存储; 头部与每一行都是独立视图, 因此完成一个条目只会重新渲染展示它的那一行, 保存观看位置
/// 只会重新渲染头部.
struct DownloadShowView: View {
    let showKey: String
    let mode: DownloadsMode
    @Environment(DownloadManager.self) private var downloads
    @Environment(AppViewModel.self) private var appVM
    @Environment(\.modelContext) private var modelContext
    @State private var playing: PlayingEpisode?
    @State private var moreDestination: PlayDestination?
    @State private var editMode: EditMode = .inactive
    @State private var selection = Set<String>()

    /// The fullscreen offline player's view model, built once when playback is requested so
    /// re-renders of this screen never rebuild it.
    ///
    /// 全屏离线播放器的视图模型, 在请求播放时构建一次, 因此本页面重新渲染时不会重建它.
    private struct PlayingEpisode: Identifiable {
        let id = UUID()
        let viewModel: OfflinePlayerViewModel
    }

    var body: some View {
        let library = downloads.librarySnapshot
        if let show = library.show(showKey: showKey) {
            let episodes = library.episodes(showKey: showKey)
            List(selection: $selection.onlyWhileEditing(editMode.isEditing)) {
                Section {
                    DownloadShowHeader(show: show, episodes: episodes, mode: mode,
                                       play: { play($0, show: show) },
                                       downloadMore: { moreDestination = $0 })
                }
                ForEach(Dictionary(grouping: episodes, by: \.sourceKey).sorted { $0.key < $1.key }, id: \.key) { _, group in
                    Section(group.first?.sourceName ?? "") {
                        ForEach(group, id: \.episodeKey) { ep in
                            DownloadEpisodeRow(episode: ep, editing: editMode.isEditing) { play(ep, show: show) }
                                .tag(ep.episodeKey)
                                .swipeActions { DownloadDeleteSwipe { await downloads.deleteFromLibrary(ep) } }
                        }
                    }
                }
            }
            .readableColumn(maxWidth: nil)
            .navigationTitle(show.title)
            .navigationBarTitleDisplayMode(.inline)
            .downloadsEditing(editMode: $editMode, selection: $selection, isEmpty: episodes.isEmpty) { keys in
                for ep in episodes where keys.contains(ep.episodeKey) { await downloads.deleteFromLibrary(ep) }
            }
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
    @Environment(DownloadManager.self) private var downloads
    @Environment(AppViewModel.self) private var appVM

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            DownloadPoster(show: show, width: 84)
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text(show.title).font(AppFont.title)
                Text("\(episodes.filter { $0.state == .completed }.count)/\(episodes.count) episodes · \(DownloadFormatting.bytes(episodes.reduce(0) { $0 + $1.bytes }))")
                    .font(AppFont.secondary.monospacedDigit())
                    .foregroundStyle(.secondary)
                // Side by side when they fit at full width, stacked otherwise; titles never wrap or
                // truncate, since a fixed-size label makes a squeezed row not fit.
                //
                // 完整宽度放得下时并排, 否则上下排列; 标题不换行也不截断, 因为固定尺寸的标签会让被挤压的
                // 一行判定为放不下.
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: Spacing.sm) { actions }
                    VStack(alignment: .leading, spacing: Spacing.sm) { actions }
                }
                .padding(.top, Spacing.xs)
            }
        }
        .padding(.vertical, Spacing.xs)
    }

    @ViewBuilder
    private var actions: some View {
        // The show's watch record names the episode to continue. It is read here, in the header's own
        // body, so only the header observes the sync store; the screen's body does not.
        //
        // 该剧的观看记录用于确定继续播放哪一集. 它在头部自己的 body 中读取, 因此只有头部观察同步存储,
        // 页面主体不会.
        let watch = appVM.sync?.store.watch(title: show.title)
        // Just "Play": episode names differ by source and can be long; the picked episode resumes
        // from its saved position.
        //
        // 只显示 "播放": 各来源的剧集名称不一致且可能很长; 选中的剧集会从保存的位置继续播放.
        if let (resume, _) = DownloadResumePicker.target(episodes: episodes, watch: watch) {
            Button {
                play(resume)
            } label: {
                Label("Play", systemImage: "play.fill")
                    .fixedSize()
            }
            .buttonStyle(.pill(prominent: true, compact: true))
            .accessibilityHint(Text(resume.episodeName))
        }
        // The most recently added download names the source to continue with.
        //
        // 以最近添加的下载所在的源作为继续下载的源.
        if mode == .online, downloads.canDownload, let source = episodes.max(by: { $0.createdAt < $1.createdAt }) {
            Button {
                downloadMore(PlayDestination(
                    title: show.title,
                    sources: [SourceResult(sourceKey: source.sourceKey, sourceName: source.sourceName,
                                           videoId: source.videoId, durationMs: 0, episodes: [])],
                    sourceKey: source.sourceKey, videoId: source.videoId, coverHint: show.cover))
            } label: {
                Text("Download More").fixedSize()
            }
            .buttonStyle(.pill(compact: true))
        }
    }
}

/// Picks the episode the show header plays.
///
/// 选择剧集头部按钮要播放的剧集.
enum DownloadResumePicker {
    /// The completed download to play from the header, and whether that continues a started
    /// episode. The watch record wins (same source first): its episode, or the next downloaded one
    /// when it was finished. Without a record, the last started episode that is not finished;
    /// otherwise the first download, played from the start.
    ///
    /// 头部按钮要播放的已完成下载, 以及是否属于继续观看. 观看记录优先 (同来源优先): 播放记录中的那一集,
    /// 若已看完则播放下一集已下载的剧集. 没有记录时, 选最后一集已开始但未看完的剧集; 否则从头播放第一集
    /// 下载.
    static func target(episodes: [DownloadEpisode], watch: WatchPayload?) -> (DownloadEpisode, Bool)? {
        let completed = episodes.filter { $0.state == .completed }.sorted { $0.episodeIndex < $1.episodeIndex }
        guard let first = completed.first else { return nil }
        if let watch {
            let matches = completed.filter { $0.episodeIndex == watch.episodeIndex }
            if let current = matches.first(where: { $0.sourceKey == watch.sourceKey }) ?? matches.first {
                if watch.completed || current.finished,
                   let next = completed.first(where: { $0.episodeIndex > current.episodeIndex && !$0.finished }) {
                    return (next, false)
                }
                return (current, true)
            }
        }
        if let started = completed.last(where: { $0.positionSec > 0 && !$0.finished }) {
            return (started, true)
        }
        return (completed.first(where: { !$0.finished }) ?? first, false)
    }
}

/// One downloaded episode: state, size or progress, watch position, and its tap action.
///
/// 一集已下载的剧集: 状态, 大小或进度, 观看位置及点按操作.
private struct DownloadEpisodeRow: View {
    let episode: DownloadEpisode
    /// While editing, a tap selects the row instead of acting on it.
    ///
    /// 编辑时点按用于选择该行, 而不是执行操作.
    let editing: Bool
    let play: () -> Void
    @Environment(DownloadManager.self) private var downloads

    var body: some View {
        let ep = episode
        let state = downloads.displayState(of: ep)
        let manageable = downloads.canManage(ep)
        // Only completed episodes play, and only the signed-in account's unfinished ones can be
        // paused, resumed, or retried; other rows stay plain, so the long-press menu still works.
        //
        // 只有已完成的剧集可以播放, 只有当前登录账号未完成的剧集可以暂停, 继续或重试; 其他行保持为普通
        // 内容, 长按菜单因此依然可用.
        if editing || (state != .completed && !manageable) {
            content(ep, state: state, manageable: manageable)
                .opacity(editing || state == .completed ? 1 : 0.6)
        } else {
            Button {
                switch state {
                case .completed: play()
                case .paused: downloads.resume(ep)
                case .failed: downloads.retry(ep)
                default: Task { await downloads.pause(ep) }
                }
            } label: {
                content(ep, state: state, manageable: manageable)
            }
            // Plain, so the List does not tint the episode name and subtitle with the accent.
            //
            // 使用 plain 样式, 避免 List 用强调色给剧集名与副标题着色.
            .buttonStyle(.plain)
        }
    }

    private func content(_ ep: DownloadEpisode, state: DownloadDisplayState, manageable: Bool) -> some View {
        HStack(spacing: Spacing.md) {
            stateIcon(state)
            VStack(alignment: .leading, spacing: Spacing.xxs + 1) {
                Text(ep.episodeName).font(AppFont.body).foregroundStyle(.primary)
                Text(subtitle(ep, state: state))
                    .font(AppFont.footnote.monospacedDigit())
                    .foregroundStyle(subtitleColor(state))
                if state == .completed, ep.durationSec > 0, ep.positionSec > 0, !ep.finished {
                    ProgressView(value: min(1, ep.positionSec / ep.durationSec)).frame(maxWidth: 160)
                }
            }
            Spacer()
            if case .failed = state, manageable, !editing {
                Text("Retry").font(AppFont.control).foregroundStyle(.tint)
            } else if state == .completed && !editing {
                Image(systemName: "play.circle.fill").font(.title2).foregroundStyle(.tint)
            }
        }
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private func stateIcon(_ state: DownloadDisplayState) -> some View {
        switch state {
        case .completed:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(StatusColor.success).font(.title3)
        case .downloading(let progress):
            ProgressView(value: progress).progressViewStyle(.circular).frame(width: 24, height: 24)
        case .failed:
            Image(systemName: "exclamationmark.circle.fill").foregroundStyle(StatusColor.danger).font(.title3)
        case .paused:
            Image(systemName: "pause.circle").foregroundStyle(.secondary).font(.title3)
        default:
            Image(systemName: "circle.dashed").foregroundStyle(.secondary).font(.title3)
        }
    }

    private func subtitle(_ ep: DownloadEpisode, state: DownloadDisplayState) -> String {
        guard state == .completed else {
            if !downloads.canManage(ep) {
                return DownloadFormatting.waitingText(for: ep, state: state, activeScopeKey: downloads.activeScopeKey)
            }
            return DownloadFormatting.text(for: state)
        }
        let size = DownloadFormatting.bytes(ep.bytes)
        if ep.finished { return "\(size) · " + String(localized: "Watched") }
        if ep.positionSec > 0 { return "\(size) · " + String(localized: "Watched to \(DownloadFormatting.duration(ep.positionSec))") }
        return size
    }

    private func subtitleColor(_ state: DownloadDisplayState) -> AnyShapeStyle {
        switch state {
        case .failed: AnyShapeStyle(StatusColor.danger)
        case .downloading, .preparing: AnyShapeStyle(.tint)
        default: AnyShapeStyle(.secondary)
        }
    }
}
#endif
