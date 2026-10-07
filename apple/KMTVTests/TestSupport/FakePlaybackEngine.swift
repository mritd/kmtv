import AVFoundation
import Foundation
@testable import KMTV

/// Scripted `PlaybackEngine`: records every command, holds seeks until the test completes them,
/// and lets the test report time, ends, errors, and pauses for the item it started last. Its
/// `player` is a bare `AVPlayer` with no item, only so the view models see a mounted player.
///
/// 脚本化的 `PlaybackEngine`: 记录每条命令, 在测试完成之前挂起 seek, 并允许测试为最近启动的 item
/// 上报时间, 结束, 错误与暂停. 其 `player` 是一个没有 item 的空 `AVPlayer`, 仅用于让视图模型看到
/// 已挂载的播放器.
@MainActor
final class FakePlaybackEngine: PlaybackEngine {
    /// One `start` call.
    ///
    /// 一次 `start` 调用.
    struct Start {
        let url: URL
        let startTime: TimeInterval
        let rate: Float
        let allowsExternalPlayback: Bool
        let loadTimeout: Duration?
        let callbacks: PlaybackCallbacks
    }

    private(set) var player: AVPlayer?
    private(set) var starts: [Start] = []
    private(set) var pauses = 0
    private(set) var resumes: [Float] = []
    private(set) var rates: [Float] = []
    private(set) var seeks: [TimeInterval] = []
    private(set) var cleanups = 0
    /// How many times a caller removed the pause observation itself with `observePause(nil)`.
    ///
    /// 调用方自行通过 `observePause(nil)` 移除暂停观察的次数.
    private(set) var pauseObservationsCleared = 0
    private(set) var watchdogSuspensions = 0
    private(set) var watchdogResumptions = 0
    private(set) var metadata: (title: String, subtitle: String)?
    private var seekCompletions: [@MainActor @Sendable (Bool) -> Void] = []
    private var pauseHandler: (@MainActor @Sendable (Bool) -> Void)?

    /// The playhead `currentTime` reports while a player exists.
    ///
    /// 存在播放器时 `currentTime` 报告的播放头位置.
    var playhead: TimeInterval = 0
    /// What `itemDuration` reports while a player exists; nil stands for no current item.
    ///
    /// 存在播放器时 `itemDuration` 报告的值; nil 表示没有当前 item.
    var duration: TimeInterval?
    var chosenRate: Float?
    var timeControlStatus: AVPlayer.TimeControlStatus?

    /// Whether `observePause` currently has a handler.
    ///
    /// `observePause` 当前是否设有回调.
    var observesPause: Bool { pauseHandler != nil }

    /// The callbacks of the item started last.
    ///
    /// 最近启动的 item 的回调.
    var callbacks: PlaybackCallbacks? { starts.last?.callbacks }

    var currentTime: TimeInterval? { player == nil ? nil : playhead }
    var itemDuration: TimeInterval? { player == nil ? nil : duration }

    func start(url: URL, startTime: TimeInterval, rate: Float, allowsExternalPlayback: Bool,
               loadTimeout: Duration?, callbacks: PlaybackCallbacks) {
        if player == nil { player = AVPlayer() }
        starts.append(Start(url: url, startTime: startTime, rate: rate,
                            allowsExternalPlayback: allowsExternalPlayback, loadTimeout: loadTimeout,
                            callbacks: callbacks))
        playhead = startTime
        timeControlStatus = .waitingToPlayAtSpecifiedRate
    }

    func pause() {
        pauses += 1
        if player != nil { timeControlStatus = .paused }
    }

    func resume(rate: Float) {
        resumes.append(rate)
        if player != nil { timeControlStatus = .playing }
    }

    func setRate(_ rate: Float) {
        rates.append(rate)
    }

    func seek(to time: TimeInterval, completion: @escaping @MainActor @Sendable (Bool) -> Void) {
        guard player != nil else { return }
        seeks.append(time)
        seekCompletions.append(completion)
    }

    /// Completes the oldest pending seek, as AVPlayer would one turn later.
    ///
    /// 完成最早的待处理 seek, 与 AVPlayer 在下一轮次的行为一致.
    func completeSeek(finished: Bool) {
        guard !seekCompletions.isEmpty else { return }
        seekCompletions.removeFirst()(finished)
    }

    func suspendLoadWatchdog() { watchdogSuspensions += 1 }

    func resumeLoadWatchdog() { watchdogResumptions += 1 }

    func setTitleMetadata(title: String, subtitle: String) {
        metadata = (title, subtitle)
    }

    func observePause(_ handler: (@MainActor @Sendable (Bool) -> Void)?) {
        if handler == nil { pauseObservationsCleared += 1 }
        pauseHandler = handler
    }

    /// Reports the pause state to the observer, if any.
    ///
    /// 向观察者 (如有) 报告暂停状态.
    func reportPaused(_ paused: Bool) {
        pauseHandler?(paused)
    }

    /// Releases the player. Pending seek completions stay: AVPlayer still delivers them after the
    /// item goes away, so tests can complete them late.
    ///
    /// 释放播放器. 待处理的 seek 回调保留: item 移除后 AVPlayer 仍会回调它们, 因此测试可以晚些完成它们.
    func cleanup() {
        cleanups += 1
        pauseHandler = nil
        player = nil
        timeControlStatus = nil
    }
}
