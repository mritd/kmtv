import Foundation
import SwiftData

struct PlaybackProgressStore {
    let modelContext: ModelContext
    let serverURL: String
    let title: String

    /// Loads persisted skip settings for the current title and server.
    /// 加载当前标题与服务器对应的跳过片头片尾设置.
    func loadSettings() -> PlaybackSettings {
        PlaybackSettings.get(in: modelContext, serverURL: serverURL, title: title)
    }

    /// Resolves resume position: saved progress first, then intro skip.
    /// 解析起播位置: 优先使用已保存进度, 其次使用跳过片头.
    func startTime(sourceKey: String, videoId: String, episodeIndex: Int, skipIntroSeconds: Int) -> TimeInterval {
        let history = WatchHistoryItem.recent(in: modelContext, serverURL: serverURL, limit: 100)
        if let saved = history.first(where: {
            $0.sourceKey == sourceKey && $0.videoId == videoId && $0.episodeIndex == episodeIndex
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
        episodeIndex: Int,
        current: TimeInterval,
        duration: TimeInterval
    ) {
        guard !videoId.isEmpty, current > 0, duration.isFinite else { return }
        WatchHistoryItem.upsert(
            in: modelContext,
            serverURL: serverURL,
            sourceKey: sourceKey,
            videoId: videoId,
            title: detail.title,
            cover: detail.cover,
            episode: episode.name,
            episodeIndex: episodeIndex,
            progress: current,
            duration: duration
        )
    }
}
