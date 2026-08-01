import Foundation
import SwiftData

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
    /// 加载当前标题与服务器对应的跳过片头片尾设置.
    func loadSettings() -> PlaybackSettings {
        PlaybackSettings.get(in: modelContext, serverURL: serverURL, title: title)
    }

    /// Resolves resume position: saved progress first, then intro skip.
    /// 解析起播位置: 优先使用已保存进度, 其次使用跳过片头.
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
    /// 保存观看进度, 用于续播与继续观看入口.
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
