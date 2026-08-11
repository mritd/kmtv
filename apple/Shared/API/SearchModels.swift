import Foundation

/// Search response containing deduplicated results.
///
/// 搜索响应, 包含去重后的结果.
struct SearchResponse: Codable, Sendable {
    let results: [SearchResult]
}

/// One deduplicated search result merged across sources.
///
/// 跨视频源合并后的单条去重搜索结果.
struct SearchResult: Codable, Sendable, Identifiable {
    /// Legacy business id used for protocol conformance, not list uniqueness.
    /// Rows with the same title/provider but different years can collide, so SearchView
    /// uses a namespaced row index for rendering identity.
    ///
    /// 为满足协议保留的业务 id, 不能作为列表唯一标识. 同标题和视频源但年份不同的结果
    /// 可能发生碰撞, 因此 SearchView 使用带命名空间的行下标作为渲染 identity.
    var id: String { title + (sources.first?.sourceKey ?? "") }
    let title: String
    let type: String
    let year: String
    let cover: String
    let desc: String
    let sources: [SourceResult]
}

/// One source entry for a searched video.
///
/// 搜索结果中某个视频源对应的视频条目.
struct SourceResult: Codable, Sendable, Identifiable, Hashable {
    /// Provider identity within one merged result.
    /// The backend retains at most one entry per `sourceKey` in a result; `videoId`
    /// remains the provider-specific video identity used for detail and history.
    ///
    /// 单个合并结果内的视频源 identity. 后端在一个结果中最多保留一个相同 `sourceKey`,
    /// `videoId` 仍是详情与观看历史使用的视频源内视频 identity.
    var id: String { sourceKey }
    let sourceKey: String
    let sourceName: String
    let isAdult: Bool
    let videoId: String
    let durationMs: Double
    let episodes: [Episode]

    enum CodingKeys: String, CodingKey {
        case sourceKey = "source_key"
        case sourceName = "source_name"
        case isAdult = "is_adult"
        case videoId = "video_id"
        case durationMs = "duration_ms"
        case episodes
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        sourceKey = try container.decode(String.self, forKey: .sourceKey)
        sourceName = try container.decode(String.self, forKey: .sourceName)
        isAdult = try container.decodeIfPresent(Bool.self, forKey: .isAdult) ?? false
        videoId = try container.decode(String.self, forKey: .videoId)
        durationMs = try container.decode(Double.self, forKey: .durationMs)
        episodes = try container.decode([Episode].self, forKey: .episodes)
    }

    /// Creates a source result, usually for tests or view-model transformations.
    ///
    /// 创建视频源结果, 通常用于测试或 view model 转换.
    init(sourceKey: String, sourceName: String, videoId: String, durationMs: Double,
         episodes: [Episode], isAdult: Bool = false) {
        self.sourceKey = sourceKey
        self.sourceName = sourceName
        self.isAdult = isAdult
        self.videoId = videoId
        self.durationMs = durationMs
        self.episodes = episodes
    }
}

/// One playable episode or line item.
///
/// 单个可播放分集或线路条目.
struct Episode: Codable, Sendable, Identifiable, Hashable {
    /// Stable identity derived from name and URL.
    ///
    /// 使用名称和 URL 派生的稳定标识.
    var id: String { name + url }
    let name: String
    let url: String
}
