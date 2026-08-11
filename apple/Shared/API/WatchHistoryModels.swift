import Foundation

/// Server-synchronized continue-watching item.
///
/// 服务端同步的继续观看条目.
struct WatchHistoryResponseItem: Codable, Sendable, Identifiable {
    let id: Int
    let sourceKey: String
    let videoId: String
    let title: String
    let cover: String
    let episode: String
    let groupIndex: Int
    let episodeIndex: Int
    let progressSec: Double
    let durationSec: Double
	let completed: Bool
	let eventTimeMS: Int64
    let createdAt: Date?
    let updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, title, cover, episode, completed
        case sourceKey = "source_key"
        case videoId = "video_id"
        case groupIndex = "group_index"
        case episodeIndex = "episode_index"
        case progressSec = "progress_sec"
		case durationSec = "duration_sec"
		case eventTimeMS = "event_time_ms"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

/// List wrapper returned by GET /history.
///
/// GET /history 返回的列表包装.
struct WatchHistoryResponse: Codable, Sendable {
    let items: [WatchHistoryResponseItem]
}

/// Request body for PUT /history.
///
/// PUT /history 请求体.
struct WatchHistoryRequest: Codable, Sendable {
    let sourceKey: String
    let videoId: String
    let title: String
    let cover: String
    let episode: String
    let groupIndex: Int
    let episodeIndex: Int
    let progressSec: Double
    let durationSec: Double
	let completed: Bool
	let eventTimeMS: Int64

    enum CodingKeys: String, CodingKey {
        case title, cover, episode, completed
        case sourceKey = "source_key"
        case videoId = "video_id"
        case groupIndex = "group_index"
        case episodeIndex = "episode_index"
        case progressSec = "progress_sec"
		case durationSec = "duration_sec"
		case eventTimeMS = "event_time_ms"
    }
}
