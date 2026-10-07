#if os(iOS)
import Foundation

/// Where the player page queues episode downloads; `DownloadManager` in the app, a fake in tests.
///
/// 播放页把剧集加入下载队列的目标; 应用中为 `DownloadManager`, 测试中为替身.
@MainActor
protocol EpisodeDownloadQueue: AnyObject {
    /// Queues `episodes` of the show and returns how many were added.
    ///
    /// 将该剧的 `episodes` 加入队列, 并返回实际加入的集数.
    func enqueue(show: DownloadShowInfo, episodes: [DownloadEpisodeRequest]) throws -> Int
}

extension DownloadManager: EpisodeDownloadQueue {}

/// What adding episodes to downloads came to; the page shows it as a toast.
///
/// 加入下载的结果; 页面将其显示为提示.
enum PlayerDownloadOutcome: Equatable {
    /// This many episodes were queued.
    ///
    /// 已加入队列的集数.
    case added(Int)
    /// The device lacks the space the episodes need.
    ///
    /// 设备空间不足以容纳这些剧集.
    case notEnoughSpace
    /// Downloads are unavailable, which in practice means no account is signed in.
    ///
    /// 下载不可用, 实际上即没有登录账号.
    case notSignedIn

    /// The toast text and style for this outcome.
    ///
    /// 该结果对应的提示文字与样式.
    var toast: (message: String, style: ToastStyle) {
        switch self {
        case .added(let count): (String(localized: "Added \(count) episodes to downloads"), .success)
        case .notEnoughSpace: (String(localized: "Not enough storage"), .error)
        case .notSignedIn: (String(localized: "Sign in to download"), .error)
        }
    }
}

extension PlayerViewModel {
    /// Download requests for the episodes at `indexes` of the current source and line; indexes
    /// outside the episode list are skipped.
    ///
    /// 当前视频源与线路中 `indexes` 对应剧集的下载请求; 超出剧集列表的索引会被跳过.
    func downloadRequests(for indexes: [Int]) -> [DownloadEpisodeRequest] {
        indexes.compactMap { index -> DownloadEpisodeRequest? in
            guard episodes.indices.contains(index) else { return nil }
            return DownloadEpisodeRequest(sourceKey: currentSourceKey, sourceName: currentSourceName,
                                          videoId: currentVideoID, episodeIndex: index,
                                          episodeName: episodes[index].name, lineIndex: currentLineIndex,
                                          episodeCount: episodes.count, episodeURL: episodes[index].url)
        }
    }

    /// Queues the episodes at `indexes` for download under the loaded detail; nil while no detail
    /// has loaded. `coverURL` is the resolved cover the download keeps.
    ///
    /// 以已加载的详情把 `indexes` 对应的剧集加入下载; 详情尚未加载时返回 nil. `coverURL` 是下载要保存的
    /// 已解析封面地址.
    func enqueueDownloads(_ indexes: [Int], into queue: some EpisodeDownloadQueue,
                          coverURL: URL?) -> PlayerDownloadOutcome? {
        guard let detail else { return nil }
        let show = DownloadShowInfo(title: detail.title, cover: detail.cover, type: detail.type, year: detail.year,
                                    coverURL: coverURL)
        do {
            return .added(try queue.enqueue(show: show, episodes: downloadRequests(for: indexes)))
        } catch DownloadEnqueueError.notEnoughSpace {
            return .notEnoughSpace
        } catch {
            return .notSignedIn
        }
    }
}
#endif
