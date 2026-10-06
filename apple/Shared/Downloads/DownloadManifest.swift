import Foundation

/// Per-episode download plan and progress, saved as `manifest.json`: one entry per file to fetch
/// (keys, init maps, segments) and one line per playlist segment to write on completion.
///
/// 每集的下载计划与进度, 保存为 `manifest.json`: 每个待下载文件 (key, init map, 分片) 一个条目,
/// 下载完成时写入的 playlist 每个分片一行.
struct DownloadManifest: Codable, Equatable, Sendable {
    /// What an entry holds.
    ///
    /// 条目的类型.
    enum Kind: String, Codable, Sendable {
        case segment
        case key
        case map
    }

    /// One file to download.
    ///
    /// 一个待下载的文件.
    struct Entry: Codable, Equatable, Sendable {
        let index: Int
        let kind: Kind
        var remoteURL: URL
        let fileName: String
        let duration: Double
        var done: Bool
        var bytes: Int64
        var attempts: Int
    }

    /// One segment line of the local playlist, pointing at entries by index.
    ///
    /// 本地 playlist 中的一个分片行, 按序号引用条目.
    struct Line: Codable, Equatable, Sendable {
        let segment: Int
        let key: Int?
        let iv: Data?
        let map: Int?
        let discontinuity: Bool
        let duration: Double
        /// Whether the source declared the map while a key was active; nil in manifests saved
        /// before this was recorded.
        ///
        /// 源 playlist 是否在某个 key 生效时声明该 map; 在记录此字段之前保存的 manifest 中为 nil.
        var mapEncrypted: Bool?

        /// Whether the line's map is ciphertext. Manifests without the flag keep the old rule: a
        /// map is encrypted when its line has a key.
        ///
        /// 该行的 map 是否为密文. 没有此标记的 manifest 沿用旧规则: 行带 key 时 map 视为加密.
        var mapIsEncrypted: Bool { map != nil && (mapEncrypted ?? (key != nil)) }
    }

    var generation: Int
    let version: Int
    let targetDuration: Int
    let mediaSequence: Int
    var entries: [Entry]
    let lines: [Line]

    /// The identity of a key or map URL. Proxied playlists give every line its own `mt` token, so
    /// the same upstream key appears under many URLs; the proxy's `url` query parameter names it.
    /// Direct URLs are their own identity.
    ///
    /// key 或 map URL 的身份. 代理后的 playlist 每一行都带各自的 `mt` token, 同一个上游 key 会以多个
    /// URL 出现; 代理的 `url` 查询参数标识它. 直连 URL 自身即为身份.
    static func dedupeKey(_ url: URL) -> String {
        if url.path.contains("/proxy/"),
           let upstream = URLComponents(url: url, resolvingAgainstBaseURL: false)?
               .queryItems?.first(where: { $0.name == "url" })?.value {
            return upstream
        }
        return url.absoluteString
    }

    /// Builds the manifest of a media playlist. Keys and maps are deduplicated by upstream URL
    /// (see `dedupeKey`); when a key has no IV, the IV is the segment's media sequence number (HLS
    /// rule), so renumbered local segments still decrypt.
    ///
    /// 由 media playlist 构建 manifest. key 与 map 按上游 URL 去重 (见 `dedupeKey`); key 没有 IV 时,
    /// 按 HLS 规则取分片的 media sequence 号作为 IV, 因此重新编号后的本地分片仍能解密.
    static func build(from playlist: HLSMediaPlaylist, generation: Int) -> DownloadManifest {
        var entries: [Entry] = []
        var keyIndex: [String: Int] = [:]
        var mapIndex: [String: Int] = [:]
        var lines: [Line] = []
        let segmentExtension = playlist.segments.contains { $0.map != nil } ? "m4s" : "ts"
        func add(_ kind: Kind, _ url: URL, _ name: String, _ duration: Double) -> Int {
            entries.append(Entry(index: entries.count, kind: kind, remoteURL: url, fileName: name,
                                 duration: duration, done: false, bytes: 0, attempts: 0))
            return entries.count - 1
        }
        for (position, segment) in playlist.segments.enumerated() {
            var key: Int?
            var iv: Data?
            if case .aes128(let uri, let explicitIV) = segment.key {
                if let existing = keyIndex[dedupeKey(uri)] {
                    key = existing
                } else {
                    key = add(.key, uri, "key-\(keyIndex.count).bin", 0)
                    keyIndex[dedupeKey(uri)] = key
                }
                iv = explicitIV ?? Self.sequenceIV(segment.mediaSequence)
            }
            var map: Int?
            if let mapURL = segment.map {
                if let existing = mapIndex[dedupeKey(mapURL)] {
                    map = existing
                } else {
                    map = add(.map, mapURL, "init-\(mapIndex.count).mp4", 0)
                    mapIndex[dedupeKey(mapURL)] = map
                }
            }
            let name = String(format: "seg-%05d.%@", position, segmentExtension)
            let segmentEntry = add(.segment, segment.uri, name, segment.duration)
            lines.append(Line(segment: segmentEntry, key: key, iv: iv, map: map,
                              discontinuity: segment.discontinuity, duration: segment.duration,
                              mapEncrypted: map == nil ? nil : segment.mapEncrypted))
        }
        return DownloadManifest(generation: generation, version: playlist.version,
                                targetDuration: playlist.targetDuration, mediaSequence: playlist.mediaSequence,
                                entries: entries, lines: lines)
    }

    /// Whether an entry is AES-128 ciphertext: the segment of a line that has a key, or a map the
    /// source declared while a key was active.
    ///
    /// 条目是否为 AES-128 密文: 带 key 的行所引用的分片, 或源 playlist 在 key 生效时声明的 map.
    func isEncrypted(entry index: Int) -> Bool {
        lines.contains { ($0.segment == index && $0.key != nil) || ($0.map == index && $0.mapIsEncrypted) }
    }

    /// The 16-byte big-endian IV for a media sequence number.
    ///
    /// media sequence 号对应的 16 字节大端 IV.
    static func sequenceIV(_ sequence: Int) -> Data {
        var bytes = [UInt8](repeating: 0, count: 16)
        var value = UInt64(max(0, sequence))
        for index in stride(from: 15, through: 8, by: -1) {
            bytes[index] = UInt8(value & 0xFF)
            value >>= 8
        }
        return Data(bytes)
    }

    /// Whether `other` describes the same files (same entry count, kinds, and durations), so a
    /// refresh can keep finished entries.
    ///
    /// `other` 是否描述同一批文件 (条目数, 类型与时长都一致), 刷新时据此保留已完成的条目.
    func matches(_ other: DownloadManifest) -> Bool {
        guard entries.count == other.entries.count, lines.count == other.lines.count else { return false }
        return zip(entries, other.entries).allSatisfy { $0.kind == $1.kind && abs($0.duration - $1.duration) < 0.01 }
    }

    /// Why `other` does not match, for logs: the entry and line counts of both (this one first),
    /// and the first entry whose kind or duration differs, with both kinds and durations. Holds
    /// only numbers and kinds, never a URL.
    ///
    /// 用于日志的不匹配原因: 双方的条目数与行数 (本 manifest 在前), 以及第一个类型或时长不同的条目
    /// 及其双方的类型与时长. 只包含数字与类型, 从不包含 URL.
    func mismatchSummary(_ other: DownloadManifest) -> String {
        var summary = "entries=\(entries.count)/\(other.entries.count) lines=\(lines.count)/\(other.lines.count)"
        guard let index = zip(entries, other.entries).enumerated().first(where: { _, pair in
            pair.0.kind != pair.1.kind || abs(pair.0.duration - pair.1.duration) >= 0.01
        })?.offset else { return summary + " first=none" }
        let (mine, theirs) = (entries[index], other.entries[index])
        summary += " first=\(index) kind=\(mine.kind.rawValue)/\(theirs.kind.rawValue)"
        summary += String(format: " duration=%.3f/%.3f", mine.duration, theirs.duration)
        return summary
    }

    /// This manifest with the newer one's URLs and generation; done flags, sizes, and attempts stay.
    ///
    /// 采用较新 manifest 的 URL 与 generation 后的本 manifest; 完成标记, 大小与尝试次数保持不变.
    func adopting(urlsFrom newer: DownloadManifest) -> DownloadManifest {
        var next = self
        next.generation = newer.generation
        for index in next.entries.indices { next.entries[index].remoteURL = newer.entries[index].remoteURL }
        return next
    }

    /// Entries still to download.
    ///
    /// 仍需下载的条目.
    var missing: [Entry] { entries.filter { !$0.done } }

    /// Whether every entry is downloaded.
    ///
    /// 是否所有条目都已下载.
    var isComplete: Bool { entries.allSatisfy(\.done) }

    /// Number of downloaded entries.
    ///
    /// 已下载的条目数.
    var doneCount: Int { entries.filter(\.done).count }

    /// Bytes of downloaded entries.
    ///
    /// 已下载条目的字节数.
    var totalBytes: Int64 { entries.reduce(0) { $0 + $1.bytes } }

    /// Playback duration of all segments.
    ///
    /// 所有分片的播放时长.
    var totalDuration: Double { lines.reduce(0) { $0 + $1.duration } }

    /// Loads a manifest; nil when the file is missing or unreadable.
    ///
    /// 读取 manifest; 文件缺失或无法读取时返回 nil.
    static func load(from url: URL) -> DownloadManifest? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(DownloadManifest.self, from: data)
    }

    /// Writes the manifest atomically.
    ///
    /// 以原子方式写入 manifest.
    func save(to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(self).write(to: url, options: .atomic)
    }
}

/// Writes the local `index.m3u8` of a completed manifest with relative URIs.
///
/// 为已完成的 manifest 生成使用相对 URI 的本地 `index.m3u8`.
enum LocalPlaylistWriter {
    /// The playlist text. Every encrypted segment gets its own key line with an explicit IV. A
    /// key applies to a map declared after it (RFC 8216 4.3.2.4), so a clear map is written while
    /// no key is active and an encrypted one after its line's key.
    ///
    /// playlist 文本. 每个加密分片都有自己的 key 行, 并显式写出 IV. key 会作用于其后声明的 map
    /// (RFC 8216 4.3.2.4), 因此明文 map 在没有生效 key 时写出, 加密 map 写在所在行的 key 之后.
    static func write(_ manifest: DownloadManifest) -> String {
        let hasMap = manifest.lines.contains { $0.map != nil }
        var out = ["#EXTM3U",
                   "#EXT-X-VERSION:\(max(manifest.version, hasMap ? 6 : 3))",
                   "#EXT-X-TARGETDURATION:\(max(1, manifest.targetDuration))",
                   "#EXT-X-MEDIA-SEQUENCE:\(manifest.mediaSequence)",
                   "#EXT-X-PLAYLIST-TYPE:VOD"]
        var encrypted = false
        var currentMap: Int?
        for line in manifest.lines {
            if line.discontinuity { out.append("#EXT-X-DISCONTINUITY") }
            let newMap = line.map.flatMap { $0 != currentMap ? $0 : nil }
            if let map = newMap, !line.mapIsEncrypted {
                if encrypted {
                    out.append("#EXT-X-KEY:METHOD=NONE")
                    encrypted = false
                }
                out.append("#EXT-X-MAP:URI=\"\(manifest.entries[map].fileName)\"")
                currentMap = map
            }
            if let key = line.key {
                let iv = (line.iv ?? Data()).map { String(format: "%02X", $0) }.joined()
                out.append("#EXT-X-KEY:METHOD=AES-128,URI=\"\(manifest.entries[key].fileName)\",IV=0x\(iv)")
                encrypted = true
            } else if encrypted {
                out.append("#EXT-X-KEY:METHOD=NONE")
                encrypted = false
            }
            if let map = newMap, line.mapIsEncrypted {
                out.append("#EXT-X-MAP:URI=\"\(manifest.entries[map].fileName)\"")
                currentMap = map
            }
            out.append("#EXTINF:\(String(format: "%.3f", line.duration)),")
            out.append(manifest.entries[line.segment].fileName)
        }
        out.append("#EXT-X-ENDLIST")
        return out.joined(separator: "\n") + "\n"
    }
}

/// Writes manifests off the main actor on one serial queue, keeping only the latest snapshot per
/// episode: a snapshot submitted while an older one waits replaces it. Snapshots are taken after
/// the files they describe are on disk, so a manifest on disk can lag the files but never runs
/// ahead of them. `flush` waits for an episode's write, and `discard` drops a pending write and
/// waits out one in progress, so deleted files are never brought back by a late write.
///
/// 在主 actor 之外通过一个串行队列写入 manifest, 每集只保留最新快照: 旧快照等待期间提交的新快照会
/// 替换它. 快照在其描述的文件落盘之后才生成, 因此磁盘上的 manifest 可能落后于文件, 但不会超前.
/// `flush` 等待某集的写入完成, `discard` 丢弃待写入的快照并等待进行中的写入结束, 因此迟到的写入
/// 不会让已删除的文件重新出现.
final class DownloadManifestWriter: @unchecked Sendable {
    /// One pending write.
    ///
    /// 一个待执行的写入.
    private struct Item {
        let url: URL
        let manifest: DownloadManifest
    }

    private let lock = NSLock()
    private var pending: [String: Item] = [:]
    private let queue = DispatchQueue(label: "com.mritd.kmtv.manifest-writer", qos: .utility)
    private let write: @Sendable (DownloadManifest, URL) throws -> Void
    private let onError: @Sendable (Error) -> Void

    /// `write` saves one manifest (tests replace it); `onError` reports a failed write.
    ///
    /// `write` 保存一个 manifest (测试会替换它); `onError` 上报写入失败.
    init(write: @escaping @Sendable (DownloadManifest, URL) throws -> Void = { try $0.save(to: $1) },
         onError: @escaping @Sendable (Error) -> Void = { _ in }) {
        self.write = write
        self.onError = onError
    }

    /// Queues the latest snapshot of an episode; returns at once.
    ///
    /// 为某集排入最新快照; 立即返回.
    func submit(_ manifest: DownloadManifest, to url: URL, key: String) {
        let schedule = lock.withLock {
            let first = pending[key] == nil
            pending[key] = Item(url: url, manifest: manifest)
            return first
        }
        if schedule { queue.async { self.writePending(key) } }
    }

    /// Returns once the latest snapshot of `key` submitted so far is on disk.
    ///
    /// 在截至目前提交的 `key` 最新快照落盘后返回.
    func flush(_ key: String) async {
        await onQueue { self.writePending(key) }
    }

    /// Returns once every snapshot submitted so far is on disk.
    ///
    /// 在截至目前提交的所有快照落盘后返回.
    func flushAll() async {
        await onQueue {
            let keys = self.lock.withLock { Array(self.pending.keys) }
            for key in keys { self.writePending(key) }
        }
    }

    /// Drops pending writes of every key that `matches` (one episode, or every episode of a scope)
    /// and returns once no write is in progress.
    ///
    /// 丢弃所有满足 `matches` 的键 (一集, 或某个作用域的所有剧集) 的待写入快照, 并在没有进行中的写入
    /// 后返回.
    func discard(where matches: @Sendable (String) -> Bool) async {
        lock.withLock { pending = pending.filter { !matches($0.key) } }
        await onQueue {}
    }

    /// Drops a pending write without waiting; for episodes known to have no write in progress.
    ///
    /// 丢弃待写入快照而不等待; 用于已知没有进行中写入的剧集.
    func cancel(_ key: String) {
        _ = lock.withLock { pending.removeValue(forKey: key) }
    }

    private func writePending(_ key: String) {
        guard let item = lock.withLock({ pending.removeValue(forKey: key) }) else { return }
        do {
            try write(item.manifest, item.url)
        } catch {
            onError(error)
        }
    }

    private func onQueue(_ work: @escaping @Sendable () -> Void) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            queue.async {
                work()
                continuation.resume()
            }
        }
    }
}
