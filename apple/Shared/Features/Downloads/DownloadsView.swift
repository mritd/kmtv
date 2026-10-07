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

/// The Downloads tab, and the only screen in offline mode: active summary, one row per show of the
/// device's library (every server and account, signed in, anonymous, or offline), and storage use.
/// The body depends only on structural changes and fetches the library's episodes once;
/// the summary, each show row, and the footer are their own views, so a finished entry re-renders
/// only the views that show its progress.
///
/// 下载 tab, 也是离线模式下唯一的页面: 进行中汇总, 本机下载库中每部剧一行 (涵盖所有服务器与账号, 无论
/// 已登录, 匿名还是离线), 以及存储占用. 页面主体只依赖结构变化, 并且只读取一次下载库中的剧集; 汇总, 每部剧的行与底部各自是独立视图, 因此完成一个条目只会重新渲染
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
        let shows = downloads.libraryShows()
        let episodes = downloads.libraryEpisodes()
        let byShow = Dictionary(grouping: episodes, by: \.showKey)
        List(selection: $selection.onlyWhileEditing(editMode.isEditing)) {
            if mode == .offline {
                Section { offlineBanner }
            }
            if mode == .online, let scope {
                // The scope's own rows, not the merged library: these are what the pump downloads
                // and what Pause All and Resume All act on.
                //
                // 使用作用域自身的数据行而非合并后的下载库: 下载队列处理的以及全部暂停与全部继续作用的
                // 正是这些行.
                DownloadsActiveSummary(episodes: downloads.episodes(in: scope))
            }
            if !shows.isEmpty {
                Section {
                    ForEach(shows, id: \.showKey) { show in
                        NavigationLink(value: DownloadShowRoute(showKey: show.showKey)) {
                            DownloadShowRow(show: show, episodes: byShow[show.showKey] ?? [], mode: mode)
                        }
                        .tag(show.showKey)
                        .swipeActions { DownloadDeleteSwipe { await downloads.deleteShowFromLibrary(showKey: show.showKey) } }
                    }
                }
            }
            if !shows.isEmpty {
                Section { DownloadsStorageFooter() }
            }
        }
        // Centered on the page rather than boxed in a list section, which reads as a stray card on iPad.
        //
        // 居中显示在页面上, 而不是放在列表分组里; 后者在 iPad 上像一张孤立的卡片.
        .overlay {
            if shows.isEmpty {
                ContentUnavailableView("No downloads yet", systemImage: "arrow.down.circle",
                                       description: Text("Download episodes from a show's page to watch them offline."))
            }
        }
        .navigationTitle("Downloads")
        .toolbar {
            if !shows.isEmpty {
                ToolbarItem(placement: .topBarTrailing) { EditButton() }
            }
            if editMode.isEditing && !selection.isEmpty {
                ToolbarItem(placement: .bottomBar) {
                    Button("Delete", role: .destructive) {
                        let doomed = shows.map(\.showKey).filter { selection.contains($0) }
                        selection = []
                        editMode = .inactive
                        Task { for showKey in doomed { await downloads.deleteShowFromLibrary(showKey: showKey) } }
                    }
                    // Red like other deletes; the app-wide accent tint would otherwise color it.
                    //
                    // 与其他删除操作一样使用红色; 否则会被全局强调色着色.
                    .tint(.red)
                }
            }
        }
        // Applied outside `.toolbar`, so `EditButton` and the bottom bar read the same binding as the list.
        //
        // 放在 `.toolbar` 之外, `EditButton` 与底部栏才能和列表读到同一个绑定.
        .environment(\.editMode, $editMode)
        // The floating tab bar would cover the bottom Delete bar, so editing hides it, as Photos does.
        //
        // 浮动标签栏会遮住底部的删除栏, 因此编辑时将其隐藏, 与 "照片" 的做法一致.
        .toolbar(editMode.isEditing ? .hidden : .automatic, for: .tabBar)
        .onChange(of: shows.isEmpty) { _, empty in
            if empty { editMode = .inactive }
        }
        .onChange(of: editMode.isEditing) { _, editing in
            if !editing { selection = [] }
        }
        .navigationDestination(for: DownloadShowRoute.self) { route in
            DownloadShowView(showKey: route.showKey, mode: mode)
        }
        // Full width: rows carry posters and progress, so they use the iPad's width like the media tabs.
        //
        // 全宽: 每行带有海报与进度, 因此与媒体类标签页一样使用 iPad 的宽度.
        .readableColumn(maxWidth: nil)
    }

    private var offlineBanner: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: "wifi.slash").font(.title3).foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text("Offline mode").font(AppFont.bodyEmphasis)
                Group {
                    if appVM.serverURL.isEmpty {
                        Text("Only downloaded episodes can be played.")
                    } else {
                        Text("Cannot reach \(appVM.serverURL). Only downloaded episodes can be played.")
                    }
                }
                .font(AppFont.footnote)
                .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Reconnect") { Task { await appVM.reconnect() } }
                .buttonStyle(.pill(selected: true, compact: true))
        }
    }
}

extension Binding where Value == Set<String> {
    /// The selection a download list binds: empty and read-only outside edit mode. On iPad a list
    /// with a selection binding selects rows on any tap, so an opened row would stay highlighted
    /// after coming back; phones select only in edit mode either way.
    ///
    /// 下载列表绑定的选择集: 非编辑模式下为空且只读. iPad 上带选择绑定的列表任意点按都会选中行, 打开过的
    /// 行返回后会一直高亮; 手机无论如何都只在编辑模式下选择.
    func onlyWhileEditing(_ editing: Bool) -> Binding<Set<String>> {
        Binding(get: { editing ? wrappedValue : [] }, set: { if editing { wrappedValue = $0 } })
    }
}

/// The swipe action that deletes a download: a red trash glyph without a title, the same on the
/// downloads list and on a show's episodes. Red is set explicitly, since the app-wide accent tint
/// would otherwise color it.
///
/// 删除下载的左滑操作: 不带文字的红色垃圾桶图标, 在下载列表与剧集分集中保持一致. 显式指定红色, 否则会被
/// 全局强调色着色.
struct DownloadDeleteSwipe: View {
    let delete: () async -> Void

    var body: some View {
        Button(role: .destructive) {
            Task { await delete() }
        } label: {
            Label("Delete", systemImage: "trash")
                .labelStyle(.iconOnly)
        }
        .tint(.red)
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
                HStack(spacing: Spacing.md) {
                    Image(systemName: "arrow.down.circle.fill").font(.title2).foregroundStyle(.tint)
                    VStack(alignment: .leading, spacing: Spacing.xxs) {
                        let downloading = active.filter { $0.state == .downloading }.count
                        Text("Downloading \(downloading), waiting \(active.count - downloading)")
                            .font(AppFont.bodyEmphasis)
                        if let first = active.first {
                            Text(DownloadFormatting.text(for: downloads.displayState(of: first)))
                                .font(AppFont.footnote.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    if active.isEmpty {
                        Button("Resume All") { downloads.resumeAll() }.buttonStyle(.pill(selected: true, compact: true))
                    } else {
                        Button("Pause All") { Task { await downloads.pauseAll() } }.buttonStyle(.pill(selected: true, compact: true))
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
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        let done = episodes.filter { $0.state == .completed }
        let failed = episodes.filter { $0.state == .failed && downloads.canManage($0) }.count
        let unfinished = episodes.filter { $0.state != .completed }
        let active = unfinished.filter { ($0.state == .downloading || $0.state == .queued) && downloads.canManage($0) }
        let sources = Set(episodes.map(\.sourceName))
        let bytes = episodes.reduce(Int64(0)) { $0 + $1.bytes }
        HStack(spacing: Spacing.md) {
            DownloadPoster(show: show, width: sizeClass == .regular ? 72 : 56)
            VStack(alignment: .leading, spacing: Spacing.xs - 1) {
                HStack(alignment: .firstTextBaseline) {
                    Text(show.title).font(AppFont.bodyEmphasis).lineLimit(1)
                    Spacer()
                    Text("\(done.count)/\(episodes.count) episodes")
                        .font(AppFont.footnote.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                Text(DisplayFormatters.metaLine([sources.count > 1 ? String(localized: "Several sources") : sources.first,
                                                 DownloadFormatting.bytes(bytes)], separator: " · "))
                    .font(AppFont.footnote)
                    .foregroundStyle(.secondary)
                if let first = active.first {
                    let state = downloads.displayState(of: first)
                    Text(DownloadFormatting.text(for: state))
                        .font(AppFont.footnote.monospacedDigit())
                        .foregroundStyle(.tint)
                    if case .downloading(let progress) = state {
                        ProgressView(value: progress)
                    }
                } else if failed > 0 {
                    Text("\(failed) failed").font(AppFont.footnote).foregroundStyle(.red)
                } else if let waiting = unfinished.first(where: { !downloads.canManage($0) }) {
                    Text(DownloadFormatting.waitingText(for: waiting, state: downloads.displayState(of: waiting),
                                                        activeScopeKey: downloads.activeScopeKey))
                        .font(AppFont.footnote)
                        .foregroundStyle(.secondary)
                }
                if let watched = episodes.filter({ $0.positionSec > 0 || $0.finished })
                    .max(by: { $0.episodeIndex < $1.episodeIndex }) {
                    Text(watched.finished ? String(localized: "Watched \(watched.episodeName)")
                         : String(localized: "Watched to \(watched.episodeName) \(DownloadFormatting.duration(watched.positionSec))"))
                        .font(AppFont.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, Spacing.xs)
    }
}

/// Storage used by every download on the device and its free space, from the manager's cache.
/// While visible it recomputes on appear and re-reads free space every `freeSpaceRefresh`.
///
/// 本机全部下载占用的存储与设备剩余空间, 取自管理器的缓存. 显示期间会在出现时重新计算,
/// 并每隔 `freeSpaceRefresh` 重新读取剩余空间.
private struct DownloadsStorageFooter: View {
    static let freeSpaceRefresh: Duration = .seconds(20)
    @Environment(DownloadManager.self) private var downloads

    var body: some View {
        HStack {
            Label("Used \(DownloadFormatting.bytes(downloads.storage.activeBytes + downloads.storage.otherBytes))",
                  systemImage: "internaldrive")
            Spacer()
            Text("Free \(DownloadFormatting.bytes(downloads.freeBytes))")
        }
        .font(AppFont.footnote.monospacedDigit())
        .foregroundStyle(.secondary)
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
    @Environment(AppViewModel.self) private var appVM
    @Environment(DownloadManager.self) private var downloads
    @State private var pendingReconnect = false

    var body: some View {
        NavigationStack {
            DownloadsView(mode: .offline)
        }
        .onChange(of: downloads.network?.isSatisfied ?? false) { wasSatisfied, satisfied in
            // Opened from server setup there is no server to reconnect to.
            //
            // 从服务器设置页打开时没有可重连的服务器.
            guard !wasSatisfied, satisfied, !appVM.serverURL.isEmpty else { return }
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
