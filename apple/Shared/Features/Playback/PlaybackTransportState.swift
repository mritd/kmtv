import AVFoundation
import Foundation
import Observation

/// The transport and timeline state the player UI shows: time, duration, the buffered bar and
/// readout, the playing and buffering flags, and the seek and scrub states that own the time
/// display. `PlayerViewModel` publishes each property under its own name; every property is
/// tracked on its own, so a view that reads one does not re-render when another changes.
///
/// 播放器 UI 展示的播放传输与时间轴状态: 时间, 时长, 缓冲进度条与文字提示, 播放与缓冲标志,
/// 以及占用时间显示的 seek 与拖动状态. `PlayerViewModel` 以原名对外发布每个属性; 每个属性单独
/// 被观察, 因此读取其中一个的视图不会因另一个变化而重新渲染.
@Observable
@MainActor
final class PlaybackTransportState {
    /// The time the UI shows: the playhead, or the scrub position while the user drags.
    ///
    /// UI 显示的时间: 播放头位置, 用户拖动时则为拖动位置.
    private(set) var currentTime: TimeInterval = 0
    var duration: TimeInterval = 0

    /// How much of the timeline is buffered, 0...1, for the progress bar's loaded track.
    ///
    /// 时间轴上已缓冲的比例, 取值 0...1, 用于进度条的已加载轨道.
    ///
    /// Fed by the coordinator's wall-clock sampler rather than by `onTimeUpdate`, which is
    /// driven by the playhead and therefore silent while paused or stalled — the moments
    /// the bar most needs to keep moving.
    ///
    /// 由协调器的墙钟采样器提供, 而非 `onTimeUpdate`: 后者由播放头驱动,
    /// 暂停或卡顿时便不再更新 — 而那正是最需要看到进度条继续前进的时刻.
    var bufferedFraction: Double = 0

    /// Seconds of playback covered from the playhead, for the fullscreen readout.
    ///
    /// 从播放头起已覆盖的播放秒数, 供全屏文字提示使用.
    ///
    /// Fullscreen hands the transport bar to `AVPlayerViewController`, whose scrubber draws
    /// no loaded range at all — measured on a real iPad, its track has exactly two levels.
    /// A number is the only way to see the buffer there without replacing Apple's controls.
    ///
    /// 全屏把控制条交给 `AVPlayerViewController`, 而它的进度条完全不绘制已加载区间 —
    /// 在真实 iPad 上实测, 其轨道恰好只有两级明暗.
    /// 因此在不替换 Apple 控件的前提下, 数字是唯一能看到缓冲的方式.
    var bufferedAheadSeconds: TimeInterval = 0

    var isPlaying = false
    /// Whether a seek or a scrub owns the time display; changed only through the seek and scrub
    /// methods, so no path can leave it set without a way to clear it.
    ///
    /// seek 或拖动是否正占用时间显示; 只能通过 seek 与拖动相关方法修改, 因此不会有路径把它置位后无法清除.
    private(set) var isSeeking = false
    var isBuffering = false

    // Scrub state: the playhead the item last reported, kept while a drag moves `currentTime`, so a
    // cancelled drag can put the label back.
    //
    // 拖动状态: item 最近一次报告的播放头, 在拖动改变 `currentTime` 时保留, 以便取消拖动时恢复显示.
    @ObservationIgnored private var isScrubbing = false
    @ObservationIgnored private var reportedTime: TimeInterval = 0

    /// Clears the timeline state a new item has not reported yet.
    ///
    /// 清除新 item 尚未报告的时间轴状态.
    ///
    /// `duration` is the one that matters most: the buffer is sampled on wall-clock ticks
    /// while `onTimeUpdate` waits for a finite duration, so the first samples of a new
    /// episode would otherwise be scaled by the previous episode's length — a bar drawn at
    /// the wrong width against a running time that also belongs to the episode just left.
    ///
    /// 其中 `duration` 最为关键: 缓冲按墙钟节拍采样,
    /// 而 `onTimeUpdate` 要等到时长有限才更新, 否则新剧集的最初几次采样
    /// 会按上一集的时长换算 — 进度条宽度错误, 旁边的播放时间同样属于刚离开的那一集.
    func reset() {
        currentTime = 0
        reportedTime = 0
        duration = 0
        bufferedFraction = 0
        bufferedAheadSeconds = 0
        // A seek that never completed — the item was replaced under it — would otherwise
        // keep both the time display and the buffered bar frozen into the new episode.
        //
        // 未能完成的 seek — item 在其进行中被替换 —
        // 否则会让播放时间与缓冲进度条一并冻结, 一直延续到新剧集.
        isSeeking = false
        isScrubbing = false
    }

    /// Takes a playhead report from the current item.
    ///
    /// 接收当前 item 的播放头上报.
    func report(current: TimeInterval, duration total: TimeInterval) {
        reportedTime = current
        // Don't overwrite currentTime while user is dragging the slider.
        //
        // 用户拖动进度条时不覆盖 currentTime, 避免 UI 跳动.
        if !isSeeking {
            currentTime = current
        }
        duration = total
    }

    /// Converts a buffered timeline position into the fraction the progress bar draws.
    ///
    /// 把缓冲到达的时间轴位置换算成进度条绘制所需的比例.
    ///
    /// `duration` is 0 until the first time update arrives, and a live stream reports an
    /// indefinite one, so both have to collapse to an empty bar rather than a NaN width.
    ///
    /// 首次时间更新到达前 `duration` 为 0, 直播流则报告不确定的时长,
    /// 两者都必须收敛为空进度条, 而不是一个 NaN 宽度.
    func applyBuffer(_ sample: BufferSample) {
        bufferedAheadSeconds = sample.ahead.isFinite ? max(0, sample.ahead) : 0
        guard duration > 0, sample.end.isFinite else {
            bufferedFraction = 0
            return
        }
        bufferedFraction = min(1, max(0, sample.end / duration))
    }

    /// Mirrors AVPlayer's transport state into the two flags the UI reads, and returns whether
    /// playback just went from playing to paused.
    ///
    /// 把 AVPlayer 的播放传输状态映射为 UI 读取的两个标志, 并返回播放是否刚从播放中变为暂停.
    func applyTransport(_ status: AVPlayer.TimeControlStatus?) -> Bool {
        let wasPlaying = isPlaying
        isPlaying = status == .playing
        isBuffering = status == .waitingToPlayAtSpecifiedRate
        return wasPlaying && status == .paused
    }

    /// Puts the UI into the seeking state.
    ///
    /// 将 UI 置为 seek 中的状态.
    func beginSeek(to time: TimeInterval) {
        currentTime = time
        // Nothing is known to be buffered at the target yet, so the bar goes back to the
        // thumb and grows again from the first sample taken after the seek lands.
        //
        // 目标位置尚不知有多少缓冲, 因此进度条先收回滑块处,
        // 待 seek 落地后的首次采样再重新增长.
        bufferedFraction = duration > 0 ? min(1, max(0, time / duration)) : 0
        // The readout has to fall back with the bar. Leaving it alone would pin the old
        // playhead's figure on screen — and visibly so, because the seek also raises the
        // waiting flag the readout stays visible for.
        //
        // 文字提示必须与进度条一同回落. 若不清除, 旧播放头的数字会被钉在画面上,
        // 而且必然可见: seek 同时会置起等待标志, 而该提示正是在等待期间持续显示.
        bufferedAheadSeconds = 0
        isSeeking = true
        isBuffering = true
    }

    /// Leaves the seeking state, but only for the seek that actually arrived; returns whether it
    /// left.
    ///
    /// 退出 seek 中的状态, 但仅针对真正到达目标的那一次 seek; 返回是否已退出.
    ///
    /// A seek superseded by a newer one — two taps on skip, or a drag ending mid-seek —
    /// completes with `finished == false` while the newer seek is still in flight. Clearing
    /// the flag there would hand the buffered bar samples that still describe the old
    /// playhead.
    ///
    /// 被更新的 seek 顶替的那一次 — 连点两下快进, 或在 seek 途中结束拖动 —
    /// 会在新 seek 仍在进行时以 `finished == false` 完成.
    /// 若在此处清除标志, 缓冲进度条就会收到仍然描述旧播放头的采样.
    func endSeek(finished: Bool) -> Bool {
        guard finished else { return false }
        isSeeking = false
        return true
    }

    /// A drag on the progress bar started: the time label follows the drag, not the playhead.
    ///
    /// 进度条拖动开始: 时间显示跟随拖动位置, 而不是播放头.
    func beginScrub() {
        isScrubbing = true
        isSeeking = true
    }

    /// Moves the time label to `fraction` of the timeline while dragging.
    ///
    /// 拖动期间把时间显示移到时间轴的 `fraction` 处.
    func updateScrub(toFraction fraction: Double) {
        guard isScrubbing else { return }
        currentTime = Self.clampedFraction(fraction) * max(duration, 1)
    }

    /// The drag ended at `fraction`. Returns the time to seek to; without a player (`canSeek`
    /// false) there is nothing to seek, so the label goes back to the playhead and nil is returned.
    /// Nil too when no drag was active.
    ///
    /// 拖动在 `fraction` 处结束. 返回要 seek 到的时间; 没有播放器 (`canSeek` 为 false) 时无从 seek,
    /// 时间显示回到播放头并返回 nil. 没有进行中的拖动时同样返回 nil.
    func endScrub(atFraction fraction: Double, canSeek: Bool) -> TimeInterval? {
        guard isScrubbing else { return nil }
        isScrubbing = false
        guard canSeek else {
            isSeeking = false
            currentTime = reportedTime
            return nil
        }
        return Self.clampedFraction(fraction) * max(duration, 1)
    }

    /// The drag was cancelled (the system took the touch, or the bar went away): no seek, and the
    /// label goes back to the playhead.
    ///
    /// 拖动被取消 (系统接管了触摸, 或进度条消失): 不 seek, 时间显示回到播放头.
    func cancelScrub() {
        guard isScrubbing else { return }
        isScrubbing = false
        isSeeking = false
        currentTime = reportedTime
    }

    private static func clampedFraction(_ fraction: Double) -> Double {
        fraction.isFinite ? min(1, max(0, fraction)) : 0
    }
}
