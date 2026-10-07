#if os(iOS)
import Foundation

/// Show metadata for a new download.
///
/// 新下载所需的剧集元数据.
struct DownloadShowInfo: Sendable, Equatable {
    let title: String
    let cover: String
    let type: String
    let year: String
    let coverURL: URL?
}

/// One episode to download.
///
/// 一集待下载的剧集.
struct DownloadEpisodeRequest: Sendable, Equatable {
    let sourceKey: String
    let sourceName: String
    let videoId: String
    let episodeIndex: Int
    let episodeName: String
    let lineIndex: Int
    let episodeCount: Int
    let episodeURL: String
}

/// Why episodes could not be queued.
///
/// 无法加入队列的原因.
enum DownloadEnqueueError: Error, Equatable {
    case notSignedIn
    case notEnoughSpace
}
#endif
