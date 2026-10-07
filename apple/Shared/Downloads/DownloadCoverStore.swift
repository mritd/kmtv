#if os(iOS)
import Foundation

/// Show posters of downloads: fetches them with the injected fetcher, saves them as `cover.jpg` in
/// the show directory, and retries the ones that never arrived. The owner saves the rows and
/// marks the change in `onSaved`.
///
/// 下载剧集的海报: 用注入的获取器下载, 以 `cover.jpg` 保存在剧集目录中, 并重试从未下载成功的海报.
/// 由持有者在 `onSaved` 中保存数据行并标记变化.
@MainActor
final class DownloadCoverStore {
    private let layout: DownloadLayout
    private let library: DownloadLibrary
    private let fetcher: @Sendable (URL) async -> Data?
    /// Called after a poster was saved and its show row updated.
    ///
    /// 海报保存且剧集数据行更新之后调用.
    var onSaved: (@MainActor () -> Void)?

    init(layout: DownloadLayout, library: DownloadLibrary, fetcher: @escaping @Sendable (URL) async -> Data?) {
        self.layout = layout
        self.library = library
        self.fetcher = fetcher
    }

    /// Local poster file of a show, if downloaded.
    ///
    /// 剧集的本地海报文件 (如已下载).
    func coverFileURL(for show: DownloadShow) -> URL? {
        guard !show.coverFile.isEmpty else { return nil }
        return layout.showDir(scopeHash: show.scopeHash, showDir: show.showDir).appending(path: show.coverFile)
    }

    /// Remote cover URL of a show: the resolved URL saved at enqueue, else `cover` when it is
    /// already absolute; nil when neither gives one.
    ///
    /// 剧集封面的远程 URL: 优先使用入队时保存的已解析 URL, 其次在 `cover` 已是绝对地址时使用它;
    /// 两者都没有时返回 nil.
    static func coverRemoteURL(for show: DownloadShow) -> URL? {
        if !show.coverURLString.isEmpty { return URL(string: show.coverURLString) }
        guard show.cover.hasPrefix("http") else { return nil }
        return URL(string: show.cover)
    }

    /// Downloads a show's poster and records it on the show row; does nothing when the fetch
    /// fails, the row is gone, or the file cannot be written.
    ///
    /// 下载剧集海报并记录到剧集数据行; 获取失败, 数据行已不存在或文件无法写入时不做任何事.
    func fetchCover(scopeKey: String, showKey: String, from url: URL) async {
        guard let data = await fetcher(url),
              let show = library.show(scopeKey: scopeKey, showKey: showKey) else { return }
        let dir = layout.showDir(scopeHash: show.scopeHash, showDir: show.showDir)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try data.write(to: dir.appending(path: "cover.jpg"), options: .atomic)
        } catch {
            return
        }
        show.coverFile = "cover.jpg"
        onSaved?()
    }

    /// Re-fetches covers that never arrived or vanished from disk, without blocking the caller;
    /// stops once `isActive` reports the scope is no longer active.
    ///
    /// 重新获取从未下载成功或已从磁盘丢失的封面, 不阻塞调用方; `isActive` 表明该作用域不再处于当前
    /// 状态时停止.
    func retryMissingCovers(scopeKey: String, isActive: @escaping @MainActor (String) -> Bool) {
        let pending = library.shows(in: scopeKey).filter { show in
            guard Self.coverRemoteURL(for: show) != nil else { return false }
            guard let file = coverFileURL(for: show) else { return true }
            return !FileManager.default.fileExists(atPath: file.path)
        }.map(\.showKey)
        guard !pending.isEmpty else { return }
        Task {
            for showKey in pending {
                guard isActive(scopeKey), let show = library.show(scopeKey: scopeKey, showKey: showKey),
                      let url = Self.coverRemoteURL(for: show) else { continue }
                await fetchCover(scopeKey: scopeKey, showKey: showKey, from: url)
            }
        }
    }
}
#endif
