import Foundation

/// Completed downloads the online player can use instead of streaming.
///
/// 在线播放器可以替代流媒体使用的已完成下载.
@MainActor
protocol LocalEpisodeProviding: AnyObject {
    /// Loopback URL of a completed download of exactly this source, video, and episode, made under
    /// any account; downloads are local first whoever is signed in.
    ///
    /// 与该来源, 视频和剧集完全一致的已完成下载的 loopback URL, 可以来自任一账号; 无论谁登录, 下载都是
    /// 本地优先.
    func localPlaybackURL(showKey: String, sourceKey: String, videoId: String, episodeIndex: Int) async -> URL?
    /// Reports that playing this download failed. The download is marked damaged only when its
    /// files are missing; intact files are kept.
    ///
    /// 上报该下载播放失败. 只有文件缺失时才标记为已损坏; 文件完好时保留.
    func reportPlaybackFailure(showKey: String, sourceKey: String, videoId: String, episodeIndex: Int)
}
