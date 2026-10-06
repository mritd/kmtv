import CryptoKit
import Foundation

/// Directory names derived from identities, so paths never contain titles or URLs.
///
/// 由身份信息推导出的目录名, 路径中因此不会出现标题或 URL.
enum DownloadPaths {
    /// The first 16 hex characters of the SHA-256 of `value`.
    ///
    /// `value` 的 SHA-256 的前 16 个十六进制字符.
    static func hash16(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).prefix(8).map { String(format: "%02x", $0) }.joined()
    }

    /// Directory of a sync scope.
    ///
    /// 同步作用域的目录.
    static func scopeHash(_ scopeKey: String) -> String { hash16(scopeKey) }

    /// Directory of a show.
    ///
    /// 剧集的目录.
    static func showDir(showKey: String) -> String { hash16(showKey) }

    /// Directory of an episode.
    ///
    /// 单集的目录.
    static func episodeDir(sourceKey: String, videoId: String, episodeIndex: Int) -> String {
        hash16("\(sourceKey)|\(videoId)|\(episodeIndex)")
    }
}

/// Identity of one background download task, stored in `URLSessionTask.taskDescription` as
/// `<scopeHash>/<showDir>/<episodeDir>/<generation>/<entryIndex>`. The delegate derives the
/// destination from it alone.
///
/// 一个后台下载任务的身份, 以 `<scopeHash>/<showDir>/<episodeDir>/<generation>/<entryIndex>` 的形式
/// 存在 `URLSessionTask.taskDescription` 中. delegate 仅凭它推导目标路径.
struct DownloadTaskID: Hashable, Sendable, CustomStringConvertible {
    let scopeHash: String
    let showDir: String
    let episodeDir: String
    let generation: Int
    let entryIndex: Int

    init(scopeHash: String, showDir: String, episodeDir: String, generation: Int, entryIndex: Int) {
        self.scopeHash = scopeHash
        self.showDir = showDir
        self.episodeDir = episodeDir
        self.generation = generation
        self.entryIndex = entryIndex
    }

    /// Parses a task description; nil when it is not one of ours.
    ///
    /// 解析任务描述; 不是本模块的描述时返回 nil.
    init?(description: String) {
        let parts = description.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 5, parts[0...2].allSatisfy({ !$0.isEmpty }),
              let generation = Int(parts[3]), let entryIndex = Int(parts[4]) else { return nil }
        self.init(scopeHash: parts[0], showDir: parts[1], episodeDir: parts[2], generation: generation,
                  entryIndex: entryIndex)
    }

    /// Key of the episode this task belongs to.
    ///
    /// 该任务所属剧集的键.
    var episodeKey: String { "\(scopeHash)/\(showDir)/\(episodeDir)" }

    var description: String { "\(episodeKey)/\(generation)/\(entryIndex)" }
}

/// On-disk layout under the downloads root.
///
/// 下载根目录下的磁盘布局.
struct DownloadLayout: Sendable {
    let root: URL

    /// `Application Support/Downloads`, created and excluded from backup.
    ///
    /// `Application Support/Downloads`, 会被创建并排除在备份之外.
    static func makeDefault() throws -> DownloadLayout {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                  appropriateFor: nil, create: true)
        var root = support.appending(path: "Downloads", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try root.setResourceValues(values)
        return DownloadLayout(root: root)
    }

    /// Directory of a scope.
    ///
    /// 作用域目录.
    func scopeDir(_ scopeHash: String) -> URL { root.appending(path: scopeHash, directoryHint: .isDirectory) }

    /// Directory of a show.
    ///
    /// 剧集目录.
    func showDir(scopeHash: String, showDir: String) -> URL {
        scopeDir(scopeHash).appending(path: showDir, directoryHint: .isDirectory)
    }

    /// Directory of an episode.
    ///
    /// 单集目录.
    func episodeDir(scopeHash: String, showDir: String, episodeDir: String) -> URL {
        self.showDir(scopeHash: scopeHash, showDir: showDir).appending(path: episodeDir, directoryHint: .isDirectory)
    }

    /// Directory of the episode a task belongs to.
    ///
    /// 任务所属单集的目录.
    func episodeDir(_ id: DownloadTaskID) -> URL {
        episodeDir(scopeHash: id.scopeHash, showDir: id.showDir, episodeDir: id.episodeDir)
    }

    /// Where the delegate drops a finished file before the manager checks its generation.
    ///
    /// delegate 在管理器核对 generation 之前放置已完成文件的位置.
    func incomingFile(_ id: DownloadTaskID) -> URL {
        episodeDir(id).appending(path: "incoming", directoryHint: .isDirectory)
            .appending(path: "\(id.generation)-\(id.entryIndex)")
    }

    /// `manifest.json` of an episode directory.
    ///
    /// 单集目录中的 `manifest.json`.
    func manifestURL(episodeDir: URL) -> URL { episodeDir.appending(path: "manifest.json") }

    /// `index.m3u8` of an episode directory.
    ///
    /// 单集目录中的 `index.m3u8`.
    func playlistURL(episodeDir: URL) -> URL { episodeDir.appending(path: "index.m3u8") }
}
