#if os(iOS)
import Foundation
import SwiftData

/// The download rows read model: library queries across scopes with their merge rules, and
/// per-scope queries. The library is every download on the device, whatever server or account it
/// was made under: anyone, signed in, anonymous, or offline, can play and delete it. Copies of one
/// show or episode under several accounts read as one. Only the active scope's unfinished episodes
/// can be paused, resumed, or retried, since that needs its account's media tokens. Callers pass
/// the active scope per call; the library keeps no engine state besides a row cache by key.
///
/// 下载数据行的读取模型: 跨作用域的下载库查询及其合并规则, 以及按作用域的查询. 下载库即本机上的全部
/// 下载, 无论它是在哪个服务器或账号下完成的: 任何人 (已登录, 匿名或离线) 都可以播放和删除. 同一部剧或
/// 同一集在多个账号下的副本视为一份. 只有当前作用域中未完成的剧集可以暂停, 继续或重试, 因为这需要其
/// 账号的媒体 token. 调用方每次传入当前作用域; 除按键缓存的数据行外, 下载库不保存任何引擎状态.
@MainActor
final class DownloadLibrary {
    private let context: ModelContext
    /// Rows by `episodeKey`, so transport events skip a fetch; a deleted row is fetched again.
    ///
    /// 以 `episodeKey` 为键的数据行, 传输事件因此无需每次查询; 已删除的行会重新查询.
    private var rows: [String: DownloadEpisode] = [:]

    init(context: ModelContext) {
        self.context = context
    }

    // MARK: - Library

    /// One show per show key across scopes, newest first; the active scope's row stands for the
    /// show when it has one.
    ///
    /// 跨作用域按剧集键每部剧一行, 最新的在前; 当前作用域有该剧时以其数据行代表该剧.
    func libraryShows(activeScopeKey: String?) -> [DownloadShow] {
        let all = (try? context.fetch(FetchDescriptor<DownloadShow>(
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]))) ?? []
        var picked: [String: DownloadShow] = [:]
        var order: [String] = []
        for show in all {
            guard let current = picked[show.showKey] else {
                picked[show.showKey] = show
                order.append(show.showKey)
                continue
            }
            if show.scopeKey == activeScopeKey && current.scopeKey != activeScopeKey { picked[show.showKey] = show }
        }
        return order.compactMap { picked[$0] }
    }

    /// The library row of one show: the active scope's, else the newest.
    ///
    /// 某部剧在下载库中的数据行: 优先当前作用域的, 否则为最新的.
    func libraryShow(showKey: String, activeScopeKey: String?) -> DownloadShow? {
        let rows = shows(showKey: showKey)
        return rows.first { $0.scopeKey == activeScopeKey } ?? rows.max { $0.createdAt < $1.createdAt }
    }

    /// One episode per (show, source, video, index) across scopes, optionally of one show, ordered
    /// by source then index. A completed copy wins, then the active scope's, then the newest.
    ///
    /// 跨作用域按 (剧集, 来源, 视频, 序号) 每集一行, 可限定某部剧, 按来源再按序号排序. 已完成的副本优先,
    /// 其次是当前作用域的, 再次是最新的.
    func libraryEpisodes(showKey: String?, activeScopeKey: String?) -> [DownloadEpisode] {
        let descriptor: FetchDescriptor<DownloadEpisode>
        if let showKey {
            descriptor = FetchDescriptor(predicate: #Predicate { $0.showKey == showKey })
        } else {
            descriptor = FetchDescriptor()
        }
        var picked: [String: DownloadEpisode] = [:]
        for ep in (try? context.fetch(descriptor)) ?? [] {
            let key = Self.libraryKey(ep)
            if let current = picked[key], !Self.prefers(ep, over: current, activeScopeKey: activeScopeKey) { continue }
            picked[key] = ep
        }
        return picked.values.sorted { ($0.sourceKey, $0.episodeIndex) < ($1.sourceKey, $1.episodeIndex) }
    }

    /// Whether any scope has a completed episode.
    ///
    /// 是否有任一作用域存在已完成的剧集.
    var hasCompletedDownloads: Bool {
        let completed = DownloadState.completed.rawValue
        let descriptor = FetchDescriptor<DownloadEpisode>(predicate: #Predicate { $0.stateRaw == completed })
        return ((try? context.fetchCount(descriptor)) ?? 0) > 0
    }

    /// A completed copy of the episode in any scope, the active scope's first. The show key is part
    /// of the match, since source keys are names each server's admin picks and two servers can
    /// reuse one for different upstreams.
    ///
    /// 任一作用域中该集的已完成副本, 优先当前作用域. 剧集键也参与匹配, 因为来源键是各服务端管理员自定义
    /// 的名称, 两个服务端可能把同一个名称用于不同的上游.
    func completedCopy(showKey: String, sourceKey: String, videoId: String, episodeIndex: Int,
                       activeScopeKey: String?) -> DownloadEpisode? {
        let completed = DownloadState.completed.rawValue
        let descriptor = FetchDescriptor<DownloadEpisode>(predicate: #Predicate {
            $0.showKey == showKey && $0.sourceKey == sourceKey && $0.videoId == videoId
                && $0.episodeIndex == episodeIndex && $0.stateRaw == completed
        })
        let copies = (try? context.fetch(descriptor)) ?? []
        return copies.first { $0.scopeKey == activeScopeKey } ?? copies.max { $0.createdAt < $1.createdAt }
    }

    /// Every copy of an episode across scopes, the episode itself included.
    ///
    /// 某一集在所有作用域中的副本, 包括它自身.
    func copies(of ep: DownloadEpisode) -> [DownloadEpisode] {
        let key = Self.libraryKey(ep)
        let showKey = ep.showKey
        return ((try? context.fetch(FetchDescriptor<DownloadEpisode>(
            predicate: #Predicate { $0.showKey == showKey }))) ?? []).filter { Self.libraryKey($0) == key }
    }

    /// Every scope's row of one show.
    ///
    /// 某部剧在所有作用域中的数据行.
    func shows(showKey: String) -> [DownloadShow] {
        let descriptor = FetchDescriptor<DownloadShow>(predicate: #Predicate { $0.showKey == showKey })
        return (try? context.fetch(descriptor)) ?? []
    }

    /// Every scope that has a show or an episode row.
    ///
    /// 拥有剧集或单集数据行的所有作用域.
    func scopeKeys() -> Set<String> {
        let shows = (try? context.fetch(FetchDescriptor<DownloadShow>())) ?? []
        let episodes = (try? context.fetch(FetchDescriptor<DownloadEpisode>())) ?? []
        return Set(shows.map(\.scopeKey) + episodes.map(\.scopeKey))
    }

    /// Key of an episode across scopes: `<showKey>/<episodeDir>`.
    ///
    /// 跨作用域的单集键: `<showKey>/<episodeDir>`.
    static func libraryKey(_ ep: DownloadEpisode) -> String {
        "\(ep.showKey)/\(ep.episodeDir)"
    }

    /// Whether `ep` stands for its library key instead of `current`: a completed copy wins, then
    /// the active scope's, then the newest.
    ///
    /// `ep` 是否取代 `current` 代表其下载库键: 已完成的副本优先, 其次是当前作用域的, 再次是最新的.
    static func prefers(_ ep: DownloadEpisode, over current: DownloadEpisode, activeScopeKey: String?) -> Bool {
        let done = ep.state == .completed, currentDone = current.state == .completed
        if done != currentDone { return done }
        let active = ep.scopeKey == activeScopeKey, currentActive = current.scopeKey == activeScopeKey
        if active != currentActive { return active }
        return ep.createdAt > current.createdAt
    }

    // MARK: - Queries

    /// Shows of a scope, newest first.
    ///
    /// 某个作用域的剧集, 最新的在前.
    func shows(in scopeKey: String) -> [DownloadShow] {
        let descriptor = FetchDescriptor<DownloadShow>(predicate: #Predicate { $0.scopeKey == scopeKey },
                                                       sortBy: [SortDescriptor(\.createdAt, order: .reverse)])
        return (try? context.fetch(descriptor)) ?? []
    }

    /// One show.
    ///
    /// 单部剧集.
    func show(scopeKey: String, showKey: String) -> DownloadShow? {
        let descriptor = FetchDescriptor<DownloadShow>(
            predicate: #Predicate { $0.scopeKey == scopeKey && $0.showKey == showKey })
        return try? context.fetch(descriptor).first
    }

    /// Episodes of a scope, optionally of one show, ordered by source then index.
    ///
    /// 某个作用域的剧集分集, 可限定某部剧, 按来源再按序号排序.
    func episodes(in scopeKey: String, showKey: String? = nil) -> [DownloadEpisode] {
        let descriptor: FetchDescriptor<DownloadEpisode>
        if let showKey {
            descriptor = FetchDescriptor(predicate: #Predicate { $0.scopeKey == scopeKey && $0.showKey == showKey })
        } else {
            descriptor = FetchDescriptor(predicate: #Predicate { $0.scopeKey == scopeKey })
        }
        return ((try? context.fetch(descriptor)) ?? []).sorted {
            ($0.sourceKey, $0.episodeIndex) < ($1.sourceKey, $1.episodeIndex)
        }
    }

    /// One episode by identity.
    ///
    /// 按身份查找一集.
    func episode(scopeKey: String, sourceKey: String, videoId: String, episodeIndex: Int) -> DownloadEpisode? {
        let descriptor = FetchDescriptor<DownloadEpisode>(predicate: #Predicate {
            $0.scopeKey == scopeKey && $0.sourceKey == sourceKey && $0.videoId == videoId && $0.episodeIndex == episodeIndex
        })
        return try? context.fetch(descriptor).first
    }

    /// One episode by `episodeKey`, from the row cache while the cached row is live.
    ///
    /// 按 `episodeKey` 查找一集; 缓存的数据行仍然存在时直接取自缓存.
    func episode(forKey key: String) -> DownloadEpisode? {
        if let row = rows[key], Self.isLive(row), row.episodeKey == key { return row }
        rows[key] = nil
        guard let parsed = EpisodeKey(relativePath: key) else { return nil }
        let (scopeHash, showDir, episodeDir) = (parsed.scopeHash, parsed.showDir, parsed.episodeDir)
        let descriptor = FetchDescriptor<DownloadEpisode>(predicate: #Predicate {
            $0.scopeHash == scopeHash && $0.showDir == showDir && $0.episodeDir == episodeDir
        })
        let row = try? context.fetch(descriptor).first
        rows[key] = row
        return row
    }

    /// Downloading rows of every scope.
    ///
    /// 所有作用域中下载中的数据行.
    func downloadingEpisodes() -> [DownloadEpisode] {
        let downloading = DownloadState.downloading.rawValue
        let descriptor = FetchDescriptor<DownloadEpisode>(predicate: #Predicate { $0.stateRaw == downloading })
        return (try? context.fetch(descriptor)) ?? []
    }

    /// Queued and downloading episodes of a scope, by a count query; 0 without a scope.
    ///
    /// 用计数查询统计某个作用域中排队与下载中的集数; 没有作用域时为 0.
    func activeEpisodeCount(in scopeKey: String?) -> Int {
        guard let scope = scopeKey else { return 0 }
        let queued = DownloadState.queued.rawValue
        let downloading = DownloadState.downloading.rawValue
        let descriptor = FetchDescriptor<DownloadEpisode>(predicate: #Predicate {
            $0.scopeKey == scope && ($0.stateRaw == queued || $0.stateRaw == downloading)
        })
        return (try? context.fetchCount(descriptor)) ?? 0
    }

    /// Bytes of every episode row on the device.
    ///
    /// 本机所有单集数据行的字节数.
    func totalBytes() -> Int64 {
        let all = (try? context.fetch(FetchDescriptor<DownloadEpisode>())) ?? []
        return all.reduce(Int64(0)) { $0 + $1.bytes }
    }

    /// Whether a row is still in the store; rows deleted across an `await` must not be read.
    ///
    /// 数据行是否仍在存储中; 跨越 `await` 期间被删除的行不能再读取.
    static func isLive(_ ep: DownloadEpisode) -> Bool {
        !ep.isDeleted && ep.modelContext != nil
    }
}
#endif
