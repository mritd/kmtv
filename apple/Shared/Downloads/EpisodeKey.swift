import Foundation

/// Identity of one downloaded episode on disk: its scope, show, and episode directories. The
/// manager, task IDs, and manifest writes key episodes by `relativePath`, whose format
/// (`<scopeHash>/<showDir>/<episodeDir>`) never changes, since rows and task descriptions persist it.
///
/// 一集已下载剧集在磁盘上的身份: 其作用域, 剧集与单集目录. 管理器, 任务 ID 与 manifest 写入以
/// `relativePath` 作为剧集的键, 其格式 (`<scopeHash>/<showDir>/<episodeDir>`) 永不改变, 因为数据行与
/// 任务描述都会持久化它.
struct EpisodeKey: Hashable, Sendable {
    let scopeHash: String
    let showDir: String
    let episodeDir: String

    init(scopeHash: String, showDir: String, episodeDir: String) {
        self.scopeHash = scopeHash
        self.showDir = showDir
        self.episodeDir = episodeDir
    }

    /// Parses `<scopeHash>/<showDir>/<episodeDir>`; nil when it does not have exactly three
    /// non-empty parts.
    ///
    /// 解析 `<scopeHash>/<showDir>/<episodeDir>`; 不是恰好三个非空部分时返回 nil.
    init?(relativePath: String) {
        let parts = relativePath.split(separator: "/").map(String.init)
        guard parts.count == 3 else { return nil }
        self.init(scopeHash: parts[0], showDir: parts[1], episodeDir: parts[2])
    }

    /// The episode directory relative to the downloads root, also the string key of the episode.
    ///
    /// 相对于下载根目录的单集目录, 同时也是该集的字符串键.
    var relativePath: String { "\(scopeHash)/\(showDir)/\(episodeDir)" }

    /// Whether the string key `relativePath` names an episode of the scope `scopeHash`.
    ///
    /// 字符串键 `relativePath` 是否指向作用域 `scopeHash` 中的一集.
    static func path(_ relativePath: String, isInScope scopeHash: String) -> Bool {
        EpisodeKey(relativePath: relativePath)?.scopeHash == scopeHash
    }
}
