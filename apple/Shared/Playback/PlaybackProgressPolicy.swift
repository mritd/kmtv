import Foundation

/// Progress rules shared by the online and offline players: when an episode counts as watched,
/// when the outro skip and the next-episode button kick in, and how often periodic checkpoints
/// are written.
///
/// 在线与离线播放器共用的进度规则: 一集何时算看完, 片尾跳过与下一集按钮何时生效,
/// 以及周期性检查点的写入频率.
enum PlaybackProgressPolicy {
    /// Shortest wall-clock gap between two periodic progress saves. Scrubbing moves the position
    /// many times a second, so a position-based gap would save on almost every callback.
    ///
    /// 两次周期性进度保存之间的最短实际时间间隔. 拖动进度条时位置每秒变化多次, 若按位置差判断,
    /// 几乎每次回调都会保存.
    static let saveInterval: Duration = .seconds(5)

    /// How long before the end (plus the outro skip) the next-episode button appears.
    ///
    /// 距结尾 (加上片尾跳过时长) 多久时显示下一集按钮.
    static let upNextLead: TimeInterval = 60

    /// Remaining seconds at or below which an episode counts as watched.
    ///
    /// 剩余秒数不超过该值时, 一集即算看完.
    static let completionTailSeconds: TimeInterval = 30

    /// Played fraction at or above which an episode counts as watched.
    ///
    /// 播放比例达到该值时, 一集即算看完.
    static let completionFraction: Double = 0.95

    /// Whether `current` of `duration` counts as watched: within the last 30 seconds, or at least
    /// 95 percent through. Unknown or zero positions never do.
    ///
    /// `current` 相对 `duration` 是否算看完: 处于最后 30 秒内, 或已播放至少 95%. 未知或为零的位置永远不算.
    static func isCompleted(current: TimeInterval, duration: TimeInterval) -> Bool {
        guard current.isFinite, duration.isFinite, duration > 0, current > 0 else { return false }
        return duration - current <= completionTailSeconds || current / duration >= completionFraction
    }

    /// Whether the playhead has entered the outro the user asked to skip. Off when the skip is 0;
    /// a playhead at or past the end is the end notification's job, not this one's.
    ///
    /// 播放头是否已进入用户要求跳过的片尾. 跳过时长为 0 时关闭; 播放头到达或越过结尾由结束通知处理,
    /// 不归这里.
    static func shouldSkipOutro(current: TimeInterval, duration: TimeInterval, skipOutroSeconds: Int) -> Bool {
        guard skipOutroSeconds > 0, duration.isFinite, duration > 0, current.isFinite else { return false }
        let remaining = duration - current
        return remaining > 0 && remaining <= TimeInterval(skipOutroSeconds)
    }

    /// Whether the playhead is close enough to the end (or to the outro skip) to offer the next
    /// episode.
    ///
    /// 播放头是否已足够接近结尾 (或片尾跳过点), 可以提供下一集.
    static func isNearEnd(current: TimeInterval, duration: TimeInterval, skipOutroSeconds: Int) -> Bool {
        guard duration.isFinite, duration > 0, current.isFinite else { return false }
        return duration - current <= upNextLead + TimeInterval(max(0, skipOutroSeconds))
    }

    /// Wall-clock throttle for periodic checkpoints. The clock is passed in, so tests can step it.
    ///
    /// 周期性检查点的墙钟节流器. 时钟由外部传入, 因此测试可以手动推进.
    struct SaveThrottle {
        private let interval: Duration
        // Instant of the last periodic save; nil lets the next callback save at once.
        //
        // 上一次周期性保存的时间点; 为 nil 时下一次回调立即保存.
        private var lastSaveAt: ContinuousClock.Instant?

        init(interval: Duration = PlaybackProgressPolicy.saveInterval) {
            self.interval = interval
        }

        /// Returns whether a periodic save is due at `now`, and if so records it as the last one.
        ///
        /// 返回 `now` 时是否应进行周期性保存; 若应保存, 则将其记为最近一次保存.
        mutating func shouldSave(at now: ContinuousClock.Instant) -> Bool {
            if let lastSaveAt, now - lastSaveAt < interval { return false }
            lastSaveAt = now
            return true
        }

        /// Starts a new period at `now`, so a new item's first tick does not save at once.
        ///
        /// 从 `now` 开始新的周期, 使新 item 的第一次时间更新不会立刻保存.
        mutating func restart(at now: ContinuousClock.Instant) {
            lastSaveAt = now
        }

        /// Lets the next callback save at once.
        ///
        /// 让下一次回调立即保存.
        mutating func reset() {
            lastSaveAt = nil
        }
    }
}
