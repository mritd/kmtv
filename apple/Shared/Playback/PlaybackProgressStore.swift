import Foundation
import SwiftData
import os

/// Playback progress and settings for one server and title. Progress comes from the sync store
/// (the watch record); settings still come from SwiftData `PlaybackSettings`.
///
/// 单个服务器与标题的播放进度和设置. 进度来自同步存储 (观看记录);
/// 设置仍来自 SwiftData 的 `PlaybackSettings`.
@MainActor
struct PlaybackProgressStore {
    let modelContext: ModelContext
    let serverURL: String
    let syncStore: SyncStore?
    let title: String

    init(modelContext: ModelContext, serverURL: String, syncStore: SyncStore?, title: String) {
        self.modelContext = modelContext
        self.serverURL = serverURL
        self.syncStore = syncStore
        self.title = title
    }

    /// Loads persisted skip settings for the current title and server.
    ///
    /// 加载当前标题与服务器对应的跳过片头片尾设置.
    func loadSettings() -> PlaybackSettings {
        PlaybackSettings.get(in: modelContext, serverURL: serverURL, title: title)
    }

    /// Persists the skip settings for the current title and server; a nil value keeps the stored one.
    /// A failed save is logged rather than silently dropped.
    ///
    /// 保存当前标题与服务器的跳过设置; 传入 nil 的值保持原样. 保存失败会记录日志, 而不是静默丢弃.
    func saveSettings(skipIntroSeconds: Int? = nil, skipOutroSeconds: Int? = nil) {
        let settings = loadSettings()
        if let skipIntroSeconds { settings.skipIntroSeconds = skipIntroSeconds }
        if let skipOutroSeconds { settings.skipOutroSeconds = skipOutroSeconds }
        do {
            try modelContext.save()
        } catch {
            Self.logger.error("saveSettings failed error=\(error.localizedDescription, privacy: .public)")
        }
    }

    private static let logger = Logger(subsystem: "com.mritd.kmtv", category: "playback")

    /// Resolves the start position: the watch record wins when it was saved for exactly this source,
    /// line, and episode and is not finished; otherwise intro skip applies.
    ///
    /// 解析起播位置: 若观看记录对应完全相同的来源, 线路和分集且未看完, 则使用其进度; 否则使用跳过片头秒数.
    ///
    /// `lookupTitle` overrides the store's title for the lookup; the player passes the loaded detail's
    /// title, which is the one the write path saves under.
    ///
    /// `lookupTitle` 覆盖存储的标题用于查找; 播放器传入已加载详情的标题, 即写入路径使用的标题.
    func startTime(sourceKey: String, videoId: String, groupIndex: Int = 0, episodeIndex: Int, skipIntroSeconds: Int,
                   title lookupTitle: String? = nil) -> TimeInterval {
        if let saved = syncStore?.watch(title: lookupTitle ?? title), !saved.completed,
           saved.sourceKey == sourceKey, saved.videoId == videoId,
           saved.groupIndex == groupIndex, saved.episodeIndex == episodeIndex, saved.progressSec > 0 {
            return saved.progressSec
        }
        return skipIntroSeconds > 0 ? TimeInterval(skipIntroSeconds) : 0
    }

    /// Writes a playback checkpoint to the sync store. Finished titles keep their record with
    /// `completed` set, so continue watching hides them on every device.
    ///
    /// 将播放进度写入同步存储. 已看完的标题保留记录并设置 completed, 让所有设备的继续观看都隐藏它.
    func saveProgress(detail: VideoDetail, sourceKey: String, videoId: String, episode: Episode,
                      groupIndex: Int = 0, episodeIndex: Int, current: TimeInterval,
                      duration: TimeInterval, completed: Bool = false) {
        saveProgress(title: detail.title, cover: detail.cover, sourceKey: sourceKey, videoId: videoId,
                     episodeName: episode.name, groupIndex: groupIndex, episodeIndex: episodeIndex,
                     current: current, duration: duration, completed: completed)
    }

    /// Writes a checkpoint from plain values, for the offline player that has no `VideoDetail`.
    ///
    /// 用普通值写入检查点, 供没有 `VideoDetail` 的离线播放器使用.
    func saveProgress(title: String, cover: String, sourceKey: String, videoId: String, episodeName: String,
                      groupIndex: Int = 0, episodeIndex: Int, current: TimeInterval, duration: TimeInterval,
                      completed: Bool = false) {
        guard !videoId.isEmpty, current.isFinite, current > 0, duration.isFinite else { return }
        syncStore?.upsert(.watch(WatchPayload(
            title: title, cover: cover, sourceKey: sourceKey, videoId: videoId,
            episode: episodeName, groupIndex: groupIndex, episodeIndex: episodeIndex,
            progressSec: current, durationSec: duration, completed: completed
        )))
    }
}
