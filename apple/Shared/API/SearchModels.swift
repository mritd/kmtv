import Foundation

/// Search response containing deduplicated results.
/// 搜索响应, 包含去重后的结果.
struct SearchResponse: Codable, Sendable {
    let results: [SearchResult]
}

/// One deduplicated search result merged across sources.
/// 跨视频源合并后的单条去重搜索结果.
struct SearchResult: Codable, Sendable, Identifiable {
    /// Stable id derived from business fields to avoid SwiftUI list thrashing.
    /// 使用业务字段派生稳定 id, 避免 SwiftUI 列表重复刷新.
    var id: String { title + (sources.first?.sourceKey ?? "") }
    let title: String
    let type: String
    let year: String
    let cover: String
    let desc: String
    let sources: [SourceResult]
}

/// One source entry for a searched video.
/// 搜索结果中某个视频源对应的视频条目.
struct SourceResult: Codable, Sendable, Identifiable, Hashable {
    /// Stable SwiftUI identity for one source entry.
    /// 单个视频源条目的稳定 SwiftUI 标识.
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
/// 单个可播放分集或线路条目.
struct Episode: Codable, Sendable, Identifiable, Hashable {
    /// Stable identity derived from name and URL.
    /// 使用名称和 URL 派生的稳定标识.
    var id: String { name + url }
    let name: String
    let url: String
}
