import Foundation
import SwiftData

/// User-scoped local playback cache operations for one server and title.
/// Resume lookup additionally requires the exact provider `sourceKey`, `videoId`,
/// line, and episode so progress cannot cross source variants.
///
/// 单个服务器与标题下按用户隔离的本地播放缓存操作. 续播查询还要求准确匹配视频源
/// `sourceKey`, `videoId`, 线路和分集, 避免进度跨视频源变体复用.
struct PlaybackProgressStore {
    let modelContext: ModelContext
	let serverURL: String
	let userID: Int64
	let title: String

	init(modelContext: ModelContext, serverURL: String, userID: Int64 = 0, title: String) {
		self.modelContext = modelContext
		self.serverURL = serverURL
		self.userID = userID
		self.title = title
	}

    /// Loads persisted skip settings for the current title and server.
    ///
    /// 加载当前标题与服务器对应的跳过片头片尾设置.
    func loadSettings() -> PlaybackSettings {
        PlaybackSettings.get(in: modelContext, serverURL: serverURL, title: title)
    }

    /// Resolves resume position for the exact source, line, and episode.
    /// Saved progress wins; intro skip is used only when no matching progress exists.
    ///
    /// 为准确的视频源, 线路和分集解析起播位置. 匹配的已保存进度优先,
    /// 仅在不存在匹配进度时使用跳过片头秒数.
    func startTime(sourceKey: String, videoId: String, groupIndex: Int = 0, episodeIndex: Int, skipIntroSeconds: Int) -> TimeInterval {
		let history = WatchHistoryItem.recent(in: modelContext, serverURL: serverURL, userID: userID, limit: 100)
        if let saved = history.first(where: {
			$0.sourceKey == sourceKey && $0.videoId == videoId
				&& $0.groupIndex == groupIndex && $0.episodeIndex == episodeIndex
        }), saved.progress > 0 {
            return saved.progress
        }
        return skipIntroSeconds > 0 ? TimeInterval(skipIntroSeconds) : 0
    }

    /// Persists watch progress for resume and continue-watching surfaces.
    /// Completing the title deletes its title-scoped cache row instead of saving
    /// a completed episode as resumable history.
    ///
    /// 保存观看进度, 用于续播与继续观看入口. 标题完成时删除标题级缓存行,
    /// 不会把已完成分集继续保存为可续播历史.
    func saveProgress(
        detail: VideoDetail,
        sourceKey: String,
        videoId: String,
        episode: Episode,
		groupIndex: Int = 0,
        episodeIndex: Int,
        current: TimeInterval,
		duration: TimeInterval,
		completed: Bool = false
    ) {
        guard !videoId.isEmpty, current > 0, duration.isFinite else { return }
		if completed {
			WatchHistoryItem.delete(in: modelContext, serverURL: serverURL, userID: userID, title: detail.title)
			return
		}
        WatchHistoryItem.upsert(
            in: modelContext,
			serverURL: serverURL,
			userID: userID,
            sourceKey: sourceKey,
            videoId: videoId,
            title: detail.title,
            cover: detail.cover,
            episode: episode.name,
			groupIndex: groupIndex,
            episodeIndex: episodeIndex,
            progress: current,
            duration: duration
        )
    }
}
