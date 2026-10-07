import Foundation

/// Facts of one manifest generation, so a finished entry costs O(1) instead of a pass over a long
/// episode: the ciphertext entries (fixed per generation) and a running count of missing entries,
/// which is rechecked against the manifest whenever it reaches zero.
///
/// 某一代 manifest 的派生信息, 让完成一个条目的开销为 O(1), 而不是遍历一整集长剧: 密文条目 (每代
/// 固定不变) 与缺失条目的计数; 计数降到零时会对照 manifest 重新核实.
struct ManifestFacts: Equatable, Sendable {
    let generation: Int
    let encrypted: Set<Int>
    var remaining: Int

    /// Derives the facts of `manifest`.
    ///
    /// 推导 `manifest` 的派生信息.
    init(_ manifest: DownloadManifest) {
        generation = manifest.generation
        encrypted = manifest.encryptedEntries
        remaining = manifest.missingCount
    }
}

/// The engine's in-memory state of one episode, kept by `episodeKey`: the cached manifest and its
/// facts, entries finished since the last manifest save, whether finished entries still have to
/// reach the row, and whether a completion is awaiting its manifest write.
///
/// 引擎在内存中保存的一集状态, 以 `episodeKey` 为键: 缓存的 manifest 及其派生信息, 上次保存 manifest
/// 后完成的条目数, 已完成条目是否尚未写入数据行, 以及完成流程是否正在等待 manifest 写入.
struct EpisodeRuntime {
    var manifest: DownloadManifest?
    var facts: ManifestFacts?
    var unsaved = 0
    /// Finished entries have not reached the row yet; flushed on the progress tick and on every
    /// state transition.
    ///
    /// 已完成条目尚未写入数据行; 在进度通知以及每次状态切换时写入.
    var progressPending = false
    /// A completion is awaiting its manifest write, so a pump meanwhile does not complete the
    /// episode a second time.
    ///
    /// 完成流程正在等待 manifest 写入, 以免期间的队列推进再次完成该集.
    var completing = false

    /// Whether nothing is cached or pending, so the entry can be dropped.
    ///
    /// 是否没有任何缓存或待处理的内容, 因此可以丢弃该条目.
    var isEmpty: Bool {
        manifest == nil && facts == nil && unsaved == 0 && !progressPending && !completing
    }

    /// The facts of `manifest`, cached per generation.
    ///
    /// `manifest` 的派生信息, 按 generation 缓存.
    mutating func facts(for manifest: DownloadManifest) -> ManifestFacts {
        if let facts, facts.generation == manifest.generation { return facts }
        let made = ManifestFacts(manifest)
        facts = made
        return made
    }

    /// Caches a manifest read from disk; its facts are derived again on next use.
    ///
    /// 缓存从磁盘读取的 manifest; 其派生信息会在下次使用时重新推导.
    mutating func cacheLoaded(_ loaded: DownloadManifest) {
        manifest = loaded
        facts = nil
    }

    /// Drops the cached manifest, its facts, the unsaved count, and pending progress. `completing`
    /// stays: the completion that set it clears it when it returns.
    ///
    /// 丢弃缓存的 manifest, 其派生信息, 未保存计数与待同步进度. `completing` 保持不变: 由设置它的完成
    /// 流程在返回时清除.
    mutating func forget() {
        manifest = nil
        facts = nil
        unsaved = 0
        progressPending = false
    }
}

extension Dictionary where Key == String, Value == EpisodeRuntime {
    /// Forgets an episode's cached state (see `EpisodeRuntime.forget()`) and drops its entry once
    /// nothing is left.
    ///
    /// 遗忘某集缓存的状态 (见 `EpisodeRuntime.forget()`), 不再剩余任何内容时丢弃其条目.
    mutating func forget(_ key: String) {
        self[key]?.forget()
        prune(key)
    }

    /// Drops an episode's entry when nothing is cached or pending.
    ///
    /// 某集没有任何缓存或待处理内容时丢弃其条目.
    mutating func prune(_ key: String) {
        if self[key]?.isEmpty == true { self[key] = nil }
    }

    /// Keys of episodes with pending progress, which no longer count as pending.
    ///
    /// 有待同步进度的剧集键; 返回后它们不再视为待同步.
    mutating func takePendingProgress() -> [String] {
        let keys = compactMap { $0.value.progressPending ? $0.key : nil }
        for key in keys {
            self[key]?.progressPending = false
            prune(key)
        }
        return keys
    }
}
