#if os(iOS)
import Foundation
import Observation

/// What the download screens show, captured on a structural change: the library's shows, its
/// episodes grouped by show, and the active scope's own episodes. Views read it instead of
/// fetching rows while rendering, so a view that reads it changes only when the structure does.
/// Progress is not in it: the rows it holds are observed models, so a row view that reads an
/// episode's progress re-renders on its own when the progress tick writes that episode.
///
/// 下载页面要展示的内容, 在结构变化时捕获: 下载库中的剧集, 按剧分组的单集, 以及当前作用域自身的单集.
/// 视图读取它, 而不是在渲染时查询数据行, 因此读取它的视图只随结构变化. 它不包含进度: 其中的数据行是
/// 被观察的模型, 读取某集进度的行视图会在进度通知写入该集时自行重新渲染.
struct DownloadLibrarySnapshot {
    /// The structural revision (`DownloadManager.changeCount`) it was built at.
    ///
    /// 构建时的结构版本 (`DownloadManager.changeCount`).
    let revision: Int
    /// One show per show key across scopes, newest first; see `DownloadLibrary.libraryShows`.
    ///
    /// 跨作用域按剧集键每部剧一行, 最新的在前; 参见 `DownloadLibrary.libraryShows`.
    let shows: [DownloadShow]
    /// The active scope's own episodes, ordered by source then index; what the pump downloads and
    /// what Pause All and Resume All act on. Empty without an active scope.
    ///
    /// 当前作用域自身的单集, 按来源再按序号排序; 即下载队列处理的以及全部暂停与全部继续作用的那些.
    /// 没有当前作用域时为空.
    let scopeEpisodes: [DownloadEpisode]
    private let showsByKey: [String: DownloadShow]
    private let episodesByShow: [String: [DownloadEpisode]]

    /// An empty snapshot, before the first build.
    ///
    /// 首次构建之前的空快照.
    init() {
        self.init(revision: 0, shows: [], episodes: [], scopeEpisodes: [])
    }

    /// Builds a snapshot from library rows: `shows` as `DownloadLibrary.libraryShows` returns them
    /// and `episodes` as `DownloadLibrary.libraryEpisodes` returns them for every show.
    ///
    /// 由下载库数据行构建快照: `shows` 为 `DownloadLibrary.libraryShows` 的结果, `episodes` 为
    /// `DownloadLibrary.libraryEpisodes` 对所有剧集的结果.
    init(revision: Int, shows: [DownloadShow], episodes: [DownloadEpisode], scopeEpisodes: [DownloadEpisode]) {
        self.revision = revision
        self.shows = shows
        self.scopeEpisodes = scopeEpisodes
        showsByKey = Dictionary(shows.map { ($0.showKey, $0) }, uniquingKeysWith: { first, _ in first })
        // Grouping keeps the source-then-index order of `episodes`.
        //
        // 分组保持 `episodes` 中先来源后序号的顺序.
        episodesByShow = Dictionary(grouping: episodes, by: \.showKey)
    }

    /// The library row of one show: the active scope's, else the newest.
    ///
    /// 某部剧在下载库中的数据行: 优先当前作用域的, 否则为最新的.
    func show(showKey: String) -> DownloadShow? {
        showsByKey[showKey]
    }

    /// The library episodes of one show, ordered by source then index.
    ///
    /// 某部剧在下载库中的单集, 按来源再按序号排序.
    func episodes(showKey: String) -> [DownloadEpisode] {
        episodesByShow[showKey] ?? []
    }
}

/// The progress tick at which one show last had entries reach its rows. Each show has its own
/// observable counter, so a view that reads one show's tick skips ticks that only moved others.
///
/// 某部剧最近一次有条目写入数据行时的进度通知序号. 每部剧都有自己的可观察计数, 因此读取某部剧序号的
/// 视图会跳过只影响其他剧的通知.
@Observable
@MainActor
final class DownloadShowTick {
    /// The latest progress tick that moved this show; 0 before any.
    ///
    /// 影响本剧的最近一次进度通知序号; 尚未有过时为 0.
    private(set) var value = 0

    /// Records that `tick` moved this show.
    ///
    /// 记录 `tick` 影响了本剧.
    func advance(to tick: Int) {
        if value != tick { value = tick }
    }
}
#endif
