import Foundation

/// The checkpoint state of the item that is playing, built on `PlaybackProgressPolicy`: the
/// wall-clock save cadence, the outro skip that fires once per item, the finished record that
/// late ticks must not overwrite, the rewatch that clears it, and the dedupe of identical
/// checkpoints. It decides; the owner writes and switches.
///
/// 正在播放的 item 的检查点状态, 基于 `PlaybackProgressPolicy`: 按墙钟的保存节奏, 每个 item
/// 只触发一次的片尾跳过, 迟到的时间更新不能覆盖的已看完记录, 清除该记录的重看, 以及相同检查点的
/// 去重. 它只负责决定; 写入与切换由所有者完成.
struct PlaybackProgressTracker {
    /// What one time report asks the owner to do. Both can be set by the same report: the save
    /// comes first, then the skip.
    ///
    /// 一次时间上报要求所有者执行的操作. 同一次上报可以同时置位两者: 先保存, 再跳过.
    struct Tick: Equatable {
        /// A periodic checkpoint is due.
        ///
        /// 应写入一次周期性检查点.
        var save = false
        /// The playhead entered the outro the user asked to skip.
        ///
        /// 播放头已进入用户要求跳过的片尾.
        var skipOutro = false
    }

    private var saveThrottle: PlaybackProgressPolicy.SaveThrottle
    // The last checkpoint written. A paused player that reports the same position again must not
    // give old progress a newer event time.
    //
    // 最近一次写入的检查点. 暂停的播放器重复报告同一位置时, 不能给旧进度新的事件时间.
    private var lastSavedCheckpoint = ""
    // Whether the outro skip already fired for this item.
    //
    // 本 item 的片尾跳过是否已触发.
    private var skipOutroTriggered = false

    /// Set once the last episode ended and its finished checkpoint was written; later checkpoints
    /// from the ended item must not overwrite it with an unfinished record. A seek, a rewatch, or a
    /// new item clears it.
    ///
    /// 最后一集结束并写入已看完检查点后置位; 已结束 item 之后的检查点不能用未看完的记录覆盖它.
    /// seek, 重看或开始新 item 时清除.
    private(set) var endCheckpointWritten = false

    init(saveInterval: Duration = PlaybackProgressPolicy.saveInterval) {
        saveThrottle = PlaybackProgressPolicy.SaveThrottle(interval: saveInterval)
    }

    /// A new item attached at `now`: the skip may fire again, nothing is finished yet, and the
    /// outgoing item's last save must not make the first tick write at once.
    ///
    /// 新 item 在 `now` 挂载: 片尾跳过可以再次触发, 尚无已看完记录, 且旧 item 的最近一次保存不能让
    /// 第一次时间更新立刻写入.
    mutating func beginItem(at now: ContinuousClock.Instant) {
        skipOutroTriggered = false
        endCheckpointWritten = false
        saveThrottle.restart(at: now)
    }

    /// Decides what a time report asks for. Only a live item (`isLive`) may save or skip; a report
    /// from any item may still end the finished state, because scrubbing back out of the finished
    /// zone after the last episode ended is a rewatch that is recorded at once.
    ///
    /// 决定一次时间上报要求的操作. 只有当前 item (`isLive`) 可以保存或跳过; 任何 item 的上报都可以
    /// 结束已看完状态, 因为最后一集结束后拖回看完区之外属于重看, 需要立即记录.
    mutating func tick(current: TimeInterval, duration: TimeInterval, isLive: Bool, skipOutroSeconds: Int,
                       now: ContinuousClock.Instant) -> Tick {
        // Late ticks near the end stay blocked so they cannot overwrite the finished record.
        //
        // 片尾附近迟到的时间更新仍被拦截, 以免覆盖已看完的记录.
        if endCheckpointWritten && duration.isFinite
            && !PlaybackProgressPolicy.isCompleted(current: current, duration: duration) {
            endCheckpointWritten = false
            saveThrottle.reset()
        }
        var tick = Tick()
        // Throttled by wall clock, not by position: scrubbing moves the position many times a
        // second and would otherwise save on almost every tick.
        //
        // 按墙钟而非位置节流: 拖动进度时位置每秒变化多次, 否则几乎每次时间更新都会保存.
        if isLive, current.isFinite, duration.isFinite, saveThrottle.shouldSave(at: now) {
            tick.save = true
        }
        if !skipOutroTriggered, isLive,
           PlaybackProgressPolicy.shouldSkipOutro(current: current, duration: duration,
                                                  skipOutroSeconds: skipOutroSeconds) {
            skipOutroTriggered = true
            tick.skipOutro = true
        }
        return tick
    }

    /// Whether `checkpoint`, a key naming the selection and the whole second, may be written: never
    /// after the finished checkpoint, and never twice in a row. A true answer records it as written.
    ///
    /// `checkpoint` (标识当前选择与整秒位置的键) 是否可以写入: 已看完检查点之后不可以, 连续两次相同
    /// 也不可以. 返回 true 时将其记为已写入.
    mutating func admit(_ checkpoint: String) -> Bool {
        guard !endCheckpointWritten, checkpoint != lastSavedCheckpoint else { return false }
        lastSavedCheckpoint = checkpoint
        return true
    }

    /// Lets the next checkpoint through the dedupe; the finished checkpoint at the end of the last
    /// episode must be written even at a position already saved.
    ///
    /// 让下一个检查点通过去重; 最后一集结尾的已看完检查点即使位置已保存过也必须写入.
    mutating func forgetLastCheckpoint() {
        lastSavedCheckpoint = ""
    }

    /// The finished checkpoint was attempted: every later checkpoint is blocked until a seek, a
    /// rewatch, or a new item.
    ///
    /// 已尝试写入已看完检查点: 在 seek, 重看或新 item 之前拦截之后的所有检查点.
    mutating func markEndWritten() {
        endCheckpointWritten = true
    }

    /// A seek moved the playhead, so a finished record may be replaced again.
    ///
    /// seek 移动了播放头, 因此已看完的记录可以再次被替换.
    mutating func seekStarted() {
        endCheckpointWritten = false
    }
}
