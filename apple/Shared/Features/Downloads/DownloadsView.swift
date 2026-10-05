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
/// storage use.
///
/// 下载 tab, 也是离线模式下唯一的页面: 进行中汇总, 每部剧一行, 以及存储占用.
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
        List(selection: $selection) {
            if mode == .offline {
                Section { offlineBanner }
            }
            if mode == .online, let scope {
                activeSummary(scope)
            }
            if shows.isEmpty {
                Section {
                    ContentUnavailableView("No downloads yet", systemImage: "arrow.down.circle",
                                           description: Text("Download episodes from a show's page to watch them offline."))
                }
            } else if let scope {
                Section {
                    ForEach(shows, id: \.showKey) { show in
                        NavigationLink(value: DownloadShowRoute(showKey: show.showKey)) {
                            showRow(show, episodes: downloads.episodes(in: scope, showKey: show.showKey))
                        }
                        .tag(show.showKey)
                    }
                    .onDelete { offsets in
                        let doomed = offsets.map { shows[$0] }
                        Task { for show in doomed { await downloads.deleteShow(show) } }
                    }
                }
            }
            if let scope {
                Section { storageFooter(scope) }
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

    @ViewBuilder
    private func activeSummary(_ scope: String) -> some View {
        let active = downloads.episodes(in: scope).filter { $0.state == .downloading || $0.state == .queued }
        let paused = downloads.episodes(in: scope).filter { $0.state == .paused }
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

    private func showRow(_ show: DownloadShow, episodes: [DownloadEpisode]) -> some View {
        let done = episodes.filter { $0.state == .completed }
        let failed = episodes.filter { $0.state == .failed }.count
        let active = episodes.filter { $0.state == .downloading || $0.state == .queued }
        let sources = Set(episodes.map(\.sourceName))
        let bytes = episodes.reduce(Int64(0)) { $0 + $1.bytes }
        return HStack(spacing: 12) {
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
                    Text(mode == .offline ? String(localized: "Will continue when online")
                         : DownloadFormatting.text(for: downloads.displayState(of: first)))
                        .font(.caption)
                        .foregroundStyle(Theme.accent)
                    if mode == .online, case .downloading(let progress) = downloads.displayState(of: first) {
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

    private func storageFooter(_ scope: String) -> some View {
        HStack {
            Text("Used \(DownloadFormatting.bytes(downloads.usedBytes(in: scope)))")
            Spacer()
            Text("Free \(DownloadFormatting.bytes(DownloadManager.deviceFreeSpace()))")
        }
        .font(.caption)
        .foregroundStyle(Theme.textSecondary)
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
