import Foundation

/// Full detail for a video from one selected source.
/// 某个选中视频源返回的视频完整详情.
struct VideoDetail: Codable, Sendable {
    let id: String
    let title: String
    let type: String
    let year: String
    let cover: String
    let desc: String
    let director: String
    let actor: String
    let area: String
    var episodes: [[Episode]]

    /// Creates a video detail, usually for tests or fallback source merging.
    /// 创建视频详情, 通常用于测试或 fallback 视频源合并.
    init(id: String, title: String, type: String, year: String, cover: String, desc: String,
         director: String, actor: String, area: String, episodes: [[Episode]]) {
        self.id = id
        self.title = title
        self.type = type
        self.year = year
        self.cover = cover
        self.desc = desc
        self.director = director
        self.actor = actor
        self.area = area
        self.episodes = episodes
    }
}

/// Request payload for resolving a playable URL.
/// 解析可播放地址的请求载荷.
struct PlaybackURLRequest: Codable, Sendable {
    let url: String
    let source: String
}

/// Response payload for resolved playback URL.
/// 解析后的播放地址响应载荷.
struct PlaybackURLResponse: Codable, Sendable {
    let mode: String
    let url: String
}
