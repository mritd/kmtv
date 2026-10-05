#if os(iOS)
import AVFoundation
import Foundation
import Observation
import SwiftData

/// Plays downloaded episodes through the loopback server, without the detail API, and saves
/// progress to the scope's sync store and the episode row.
///
/// 通过 loopback 服务播放已下载的剧集, 不依赖详情接口, 并把进度写入作用域的同步存储与剧集行.
@Observable
@MainActor
final class OfflinePlayerViewModel {
    let show: DownloadShow
    private(set) var episode: DownloadEpisode
    private(set) var player: AVPlayer?
    var error: String?

    @ObservationIgnored private let manager: DownloadManager
    @ObservationIgnored private let progressStore: PlaybackProgressStore
    @ObservationIgnored private let syncStore: SyncStore?
    @ObservationIgnored private let coordinator = PlaybackCoordinator()
    @ObservationIgnored private let skipIntroSeconds: Int
    @ObservationIgnored private let skipOutroSeconds: Int
    @ObservationIgnored private var lastSave: TimeInterval = 0
    @ObservationIgnored private var lastDuration: TimeInterval = 0
    @ObservationIgnored private var outroHandled = false
    // One automatic rebuild per episode when playback fails with intact files (for example after
    // the loopback server moved to another port).
    //
    // 文件完好但播放失败时 (例如 loopback 服务换了端口), 每集自动重建一次.
    @ObservationIgnored private var rebuiltAfterFailure = false
    // True between `suspend()` and `resume()`; errors in that window come from the stopped server.
    //
    // 在 `suspend()` 与 `resume()` 之间为 true; 此期间的错误来自已停止的服务.
    @ObservationIgnored private var suspended = false

    init(manager: DownloadManager, show: DownloadShow, episode: DownloadEpisode, modelContext: ModelContext,
         serverURL: String, syncStore: SyncStore?) {
        self.manager = manager
        self.show = show
        self.episode = episode
        self.syncStore = syncStore
        progressStore = PlaybackProgressStore(modelContext: modelContext, serverURL: serverURL, syncStore: syncStore,
                                              title: show.title)
        let settings = progressStore.loadSettings()
        skipIntroSeconds = settings.skipIntroSeconds
        skipOutroSeconds = settings.skipOutroSeconds
    }

    /// Start position: an unfinished watch record saved for exactly this source, video, line, and
    /// episode; otherwise the episode's own unfinished position; otherwise the intro skip.
    ///
    /// 起播位置: 若有为完全相同的来源, 视频, 线路与分集保存且未看完的观看记录, 则用它; 否则用该集自身
    /// 未看完的位置; 再否则使用跳过片头秒数.
    static func startTime(record: WatchPayload?, episode: DownloadEpisode, skipIntroSeconds: Int) -> TimeInterval {
        if let record, !record.completed, record.sourceKey == episode.sourceKey, record.videoId == episode.videoId,
           record.groupIndex == episode.lineIndex, record.episodeIndex == episode.episodeIndex, record.progressSec > 0 {
            return record.progressSec
        }
        if !episode.finished, episode.positionSec > 0 { return episode.positionSec }
        return skipIntroSeconds > 0 ? TimeInterval(skipIntroSeconds) : 0
    }

    /// The next completed episode of the same source and video.
    ///
    /// 同一来源与视频的下一个已完成剧集.
    var nextEpisode: DownloadEpisode? {
        manager.episodes(in: episode.scopeKey, showKey: episode.showKey)
            .filter { $0.sourceKey == episode.sourceKey && $0.videoId == episode.videoId
                && $0.state == .completed && $0.episodeIndex > episode.episodeIndex }
            .min { $0.episodeIndex < $1.episodeIndex }
    }

    /// Starts the current episode.
    ///
    /// 开始播放当前剧集.
    func start() async {
        error = nil
        let url: URL
        do {
            url = try await manager.localPlaybackURL(for: episode)
        } catch {
            fail()
            return
        }
        let start = Self.startTime(record: syncStore?.watch(title: show.title), episode: episode,
                                   skipIntroSeconds: skipIntroSeconds)
        lastSave = start
        outroHandled = false
        coordinator.start(url: url, startTime: start, rate: 1, allowsExternalPlayback: false,
                          onTime: { [weak self] current, total in self?.onTime(current: current, total: total) },
                          onBuffer: { _ in },
                          onEnd: { [weak self] in self?.finishCurrent() },
                          onError: { [weak self] _ in self?.fail() })
        player = coordinator.player
    }

    /// Plays the next completed episode, if any.
    ///
    /// 播放下一个已完成的剧集 (如有).
    func playNext() {
        checkpoint()
        guard let next = nextEpisode else { return }
        episode = next
        rebuiltAfterFailure = false
        Task { await start() }
    }

    /// Checkpoints and pauses when the app leaves the foreground. The player stays, so the screen
    /// keeps its state; the loopback server stops listening until `resume()`.
    ///
    /// App 离开前台时写入检查点并暂停. 播放器保留, 界面状态不变; loopback 服务在 `resume()` 之前停止监听.
    func suspend() {
        guard player != nil, !suspended else { return }
        checkpoint()
        player?.pause()
        suspended = true
    }

    /// Rebuilds the item at the checkpoint when the app returns, because the connections of the
    /// old item died with the server's listener.
    ///
    /// App 返回时在检查点处重建 item, 因为旧 item 的连接已随服务的 listener 一起失效.
    func resume() async {
        guard suspended else { return }
        suspended = false
        await start()
    }

    /// Saves the position and stops playback.
    ///
    /// 保存位置并停止播放.
    func close() {
        checkpoint()
        coordinator.cleanup()
        player = nil
    }

    /// Writes a checkpoint. `completed` reaches the watch record only for the last episode of the
    /// line, because only a client that knows the episode list may finish a title (ADR-015).
    ///
    /// 写入检查点. 只有该线路的最后一集才会把 `completed` 写入观看记录, 因为只有知道剧集列表的客户端
    /// 才能将一部剧标记为看完 (ADR-015).
    func record(current: TimeInterval, duration: TimeInterval, finished: Bool) {
        guard current.isFinite, duration.isFinite, current > 0, duration > 0 else { return }
        let done = finished || duration - current <= 30 || current / duration >= 0.95
        let isLast = episode.episodeIndex >= episode.episodeCount - 1
        progressStore.saveProgress(title: show.title, cover: show.cover, sourceKey: episode.sourceKey,
                                   videoId: episode.videoId, episodeName: episode.episodeName,
                                   groupIndex: episode.lineIndex, episodeIndex: episode.episodeIndex,
                                   current: current, duration: duration, completed: done && isLast)
        manager.recordWatch(episode, positionSec: current, finished: done)
    }

    private func onTime(current: TimeInterval, total: TimeInterval) {
        lastDuration = total
        if abs(current - lastSave) >= 5 {
            lastSave = current
            record(current: current, duration: total, finished: false)
        }
        if !outroHandled, skipOutroSeconds > 0, total > 0, total - current > 0,
           total - current <= TimeInterval(skipOutroSeconds) {
            outroHandled = true
            finishCurrent()
        }
    }

    private func finishCurrent() {
        let total = lastDuration > 0 ? lastDuration : episode.durationSec
        record(current: total, duration: total, finished: true)
        guard let next = nextEpisode else { return }
        episode = next
        rebuiltAfterFailure = false
        Task { await start() }
    }

    private func checkpoint() {
        guard let player, let item = player.currentItem else { return }
        let current = CMTimeGetSeconds(player.currentTime())
        let total = CMTimeGetSeconds(item.duration)
        if current.isFinite, total.isFinite, current > 0, total > 0 {
            record(current: current, duration: total, finished: false)
        }
    }

    /// A failure deletes the download only when its files are gone. With intact files the item is
    /// rebuilt once at the checkpoint; a second failure shows an error and keeps the files.
    ///
    /// 只有文件确实缺失时, 失败才会删除下载. 文件完好时在检查点处重建一次 item; 再次失败则提示错误并保留文件.
    private func fail() {
        guard !suspended else { return }
        checkpoint()
        coordinator.cleanup()
        player = nil
        if !manager.filesIntact(episode) {
            error = String(localized: "File damaged, download again")
            manager.markDamaged(episode)
        } else if !rebuiltAfterFailure {
            rebuiltAfterFailure = true
            Task { await start() }
        } else {
            error = String(localized: "Playback failed, try again later")
        }
    }
}
#endif
