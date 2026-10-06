#if os(iOS)
import SwiftUI

/// Whether the downloads list runs signed in or offline.
///
/// 下载列表处于已登录状态还是离线状态.
enum DownloadsMode {
    case online
    case offline
}

/// Navigation value for one show's downloads.
///
/// 某部剧下载内容的导航值.
struct DownloadShowRoute: Hashable {
    let showKey: String
}

/// The Downloads tab, and the only screen in offline mode: active summary, one row per show, and
/// storage use. The body depends only on structural changes and fetches the scope's episodes once;
/// the summary, each show row, and the footer are their own views, so a finished entry re-renders
/// only the views that show its progress.
///
/// 下载 tab, 也是离线模式下唯一的页面: 进行中汇总, 每部剧一行, 以及存储占用. 页面主体只依赖结构变化,
/// 并且只读取一次作用域内的剧集; 汇总, 每部剧的行与底部各自是独立视图, 因此完成一个条目只会重新渲染
/// 展示其进度的视图.
struct DownloadsView: View {
    let mode: DownloadsMode
    @Environment(DownloadManager.self) private var downloads
    @Environment(AppViewModel.self) private var appVM
    @State private var editMode: EditMode = .inactive
    @State private var selection = Set<String>()

    var body: some View {
        let _ = downloads.changeCount
        let scope = downloads.activeScopeKey
        let shows = scope.map { downloads.shows(in: $0) } ?? []
        let episodes = scope.map { downloads.episodes(in: $0) } ?? []
        let byShow = Dictionary(grouping: episodes, by: \.showKey)
        List(selection: $selection) {
            if mode == .offline {
                Section { offlineBanner }
            }
            if mode == .online, scope != nil {
                DownloadsActiveSummary(episodes: episodes)
            }
            if shows.isEmpty {
                Section {
                    ContentUnavailableView("No downloads yet", systemImage: "arrow.down.circle",
                                           description: Text("Download episodes from a show's page to watch them offline."))
                }
            } else {
                Section {
                    ForEach(shows, id: \.showKey) { show in
                        NavigationLink(value: DownloadShowRoute(showKey: show.showKey)) {
                            DownloadShowRow(show: show, episodes: byShow[show.showKey] ?? [], mode: mode)
                        }
                        .tag(show.showKey)
                    }
                    .onDelete { offsets in
                        let doomed = offsets.map { shows[$0] }
                        Task { for show in doomed { await downloads.deleteShow(show) } }
                    }
                }
            }
            if scope != nil {
                Section { DownloadsStorageFooter() }
            }
        }
        .navigationTitle("Downloads")
        .toolbar {
            if mode == .online && !shows.isEmpty {
                ToolbarItem(placement: .topBarTrailing) { EditButton() }
            }
            if editMode.isEditing && !selection.isEmpty {
                ToolbarItem(placement: .bottomBar) {
                    Button("Delete", role: .destructive) {
                        let doomed = shows.filter { selection.contains($0.showKey) }
                        selection = []
                        editMode = .inactive
                        Task { for show in doomed { await downloads.deleteShow(show) } }
                    }
                }
            }
        }
        // Applied outside `.toolbar`, so `EditButton` and the bottom bar read the same binding as the list.
        //
        // 放在 `.toolbar` 之外, `EditButton` 与底部栏才能和列表读到同一个绑定.
        .environment(\.editMode, $editMode)
        .onChange(of: shows.isEmpty) { _, empty in
            if empty { editMode = .inactive }
        }
        .navigationDestination(for: DownloadShowRoute.self) { route in
            DownloadShowView(showKey: route.showKey, mode: mode)
        }
        .frame(maxWidth: 820)
        .frame(maxWidth: .infinity)
    }

    private var offlineBanner: some View {
        HStack(spacing: 12) {
            Image(systemName: "wifi.slash").font(.title3).foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 2) {
                Text("Offline mode").font(.headline)
                Text("Cannot reach \(appVM.serverURL). Only downloaded episodes can be played.")
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            Button("Reconnect") { Task { await appVM.reconnect() } }
                .buttonStyle(.bordered)
        }
    }
}

/// Counts of downloading, waiting, and paused episodes with pause all or resume all.
///
/// 下载中, 等待中与已暂停的集数, 以及全部暂停或全部继续.
private struct DownloadsActiveSummary: View {
    let episodes: [DownloadEpisode]
    @Environment(DownloadManager.self) private var downloads

    var body: some View {
        let active = episodes.filter { $0.state == .downloading || $0.state == .queued }
        let paused = episodes.filter { $0.state == .paused }
        if !active.isEmpty || !paused.isEmpty {
            Section {
                HStack(spacing: 12) {
                    Image(systemName: "arrow.down.circle").font(.title2).foregroundStyle(Theme.accent)
                    VStack(alignment: .leading, spacing: 2) {
                        let downloading = active.filter { $0.state == .downloading }.count
                        Text("Downloading \(downloading), waiting \(active.count - downloading)").font(.subheadline.weight(.semibold))
                        if let first = active.first {
                            Text(DownloadFormatting.text(for: downloads.displayState(of: first)))
                                .font(.caption)
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                    Spacer()
                    if active.isEmpty {
                        Button("Resume All") { downloads.resumeAll() }.buttonStyle(.bordered)
                    } else {
                        Button("Pause All") { Task { await downloads.pauseAll() } }.buttonStyle(.bordered)
                    }
                }
            }
        }
    }
}

/// One show in the downloads list: poster, counts, sources, size, progress, and watch position.
///
/// 下载列表中的一部剧: 海报, 数量, 来源, 大小, 进度与观看位置.
private struct DownloadShowRow: View {
    let show: DownloadShow
    let episodes: [DownloadEpisode]
    let mode: DownloadsMode
    @Environment(DownloadManager.self) private var downloads

    var body: some View {
        let done = episodes.filter { $0.state == .completed }
        let failed = episodes.filter { $0.state == .failed }.count
        let active = episodes.filter { $0.state == .downloading || $0.state == .queued }
        let sources = Set(episodes.map(\.sourceName))
        let bytes = episodes.reduce(Int64(0)) { $0 + $1.bytes }
        HStack(spacing: 12) {
            DownloadPoster(show: show, width: 56)
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(show.title).font(.headline).lineLimit(1)
                    Spacer()
                    Text("\(done.count)/\(episodes.count) episodes").font(.caption).foregroundStyle(Theme.textSecondary)
                }
                Text(DisplayFormatters.metaLine([sources.count > 1 ? String(localized: "Several sources") : sources.first,
                                                 DownloadFormatting.bytes(bytes)], separator: " · "))
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
                if let first = active.first {
                    let state = downloads.displayState(of: first)
                    Text(mode == .offline ? String(localized: "Will continue when online") : DownloadFormatting.text(for: state))
                        .font(.caption)
                        .foregroundStyle(Theme.accent)
                    if mode == .online, case .downloading(let progress) = state {
                        ProgressView(value: progress).tint(Theme.accent)
                    }
                } else if failed > 0 {
                    Text("\(failed) failed").font(.caption).foregroundStyle(.red)
                }
                if let watched = episodes.filter({ $0.positionSec > 0 || $0.finished })
                    .max(by: { $0.episodeIndex < $1.episodeIndex }) {
                    Text(watched.finished ? String(localized: "Watched \(watched.episodeName)")
                         : String(localized: "Watched to \(watched.episodeName) \(DownloadFormatting.duration(watched.positionSec))"))
                        .font(.caption)
                        .foregroundStyle(Theme.textSecondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/// Storage used by this account's downloads and the device's free space, from the manager's cache.
/// While visible it recomputes on appear and re-reads free space every `freeSpaceRefresh`.
///
/// 本账号下载占用的存储与设备剩余空间, 取自管理器的缓存. 显示期间会在出现时重新计算,
/// 并每隔 `freeSpaceRefresh` 重新读取剩余空间.
private struct DownloadsStorageFooter: View {
    static let freeSpaceRefresh: Duration = .seconds(20)
    @Environment(DownloadManager.self) private var downloads

    var body: some View {
        HStack {
            Text("Used \(DownloadFormatting.bytes(downloads.storage.activeBytes))")
            Spacer()
            Text("Free \(DownloadFormatting.bytes(downloads.storage.freeBytes))")
        }
        .font(.caption)
        .foregroundStyle(Theme.textSecondary)
        .task {
            downloads.refreshStorage()
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.freeSpaceRefresh)
                guard !Task.isCancelled else { return }
                await downloads.refreshFreeSpace()
            }
        }
    }
}

/// Root of offline mode: the downloads list in its own stack. A network that comes back (an
/// unsatisfied path turning satisfied) reconnects once; while an offline player is open the
/// reconnect waits until it closes. Closing a player without such a change does nothing, so a
/// server that is down but reachable by path does not cause a reconnect loop.
///
/// 离线模式的根视图: 独立导航栈中的下载列表. 网络恢复 (路径由不可用变为可用) 时自动重连一次; 若离线
/// 播放器正在播放, 则等它关闭后再重连. 没有发生这种变化时关闭播放器不会触发任何操作, 因此服务端宕机但
/// 网络可达时不会反复重连.
struct OfflineRootView: View {
    let identity: DownloadIdentity
    @Environment(AppViewModel.self) private var appVM
    @Environment(DownloadManager.self) private var downloads
    @State private var pendingReconnect = false

    var body: some View {
        NavigationStack {
            DownloadsView(mode: .offline)
        }
        .onChange(of: downloads.network?.isSatisfied ?? false) { wasSatisfied, satisfied in
            guard !wasSatisfied, satisfied else { return }
            if downloads.offlinePlaybackActive {
                pendingReconnect = true
            } else {
                Task { await appVM.reconnect() }
            }
        }
        .onChange(of: downloads.offlinePlaybackActive) { _, active in
            guard !active, pendingReconnect else { return }
            pendingReconnect = false
            if downloads.network?.isSatisfied == true { Task { await appVM.reconnect() } }
        }
    }
}
#endif
