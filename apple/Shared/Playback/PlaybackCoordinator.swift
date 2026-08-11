import AVFoundation
import Foundation
import os

/// One reading of the forward buffer, in the two forms the UI needs.
///
/// 一次前向缓冲读数, 以 UI 所需的两种形式给出.
///
/// The progress bar draws a position on the timeline while a readout states how much
/// playback is covered, and neither can be derived from the other without the playhead the
/// coordinator already holds.
///
/// 进度条绘制的是时间轴上的位置, 而文字提示说明的是还能播多久,
/// 两者无法互相推导, 除非借助协调器已经持有的播放头.
struct BufferSample {
    /// Timeline position the buffer reaches, in seconds.
    ///
    /// 缓冲在时间轴上到达的位置, 单位秒.
    let end: TimeInterval

    /// Seconds of media playable from the playhead without fetching more.
    ///
    /// 从播放头起无需再拉取即可播放的秒数.
    let ahead: TimeInterval
}

@MainActor
final class PlaybackCoordinator {
    /// How far ahead AVPlayer is asked to pre-buffer, in seconds.
    ///
    /// 请求 AVPlayer 预缓冲的时长, 单位秒.
    ///
    /// Left at the default 0, AVPlayer decides for itself and stops early. Measured on an
    /// iOS 26.1 simulator, both legs playing the same stream through this app's own proxy
    /// for the same 70 seconds and differing only in this value: the default reached a
    /// 21.9s forward buffer and reported `isPlaybackBufferFull`, while 180 reached 91.6s
    /// and never reported full, meaning the player was still willing to fetch more.
    ///
    /// 保持默认值 0 时, AVPlayer 自行决定并且很早就停. 在 iOS 26.1 模拟器上实测,
    /// 两组都通过本应用自己的代理播放同一条流, 时长同为 70 秒, 仅此值不同:
    /// 默认值达到 21.9s 前向缓冲并报告 `isPlaybackBufferFull`,
    /// 而 180 达到 91.6s 且从未报告已满, 说明播放器仍愿意继续获取.
    ///
    /// Three minutes is a deliberate bound rather than the largest number that works.
    /// Apple documents high values as increasing resource demands and promises no
    /// automatic cap, so an unbounded request would rely on a self-limiting behaviour
    /// that was only ever observed on one simulator; on cellular the surplus download is
    /// the user's data. Raising it is a one-line change if real devices justify it.
    ///
    /// 取三分钟是刻意设的上界, 而非能生效的最大值.
    /// Apple 明确高值会提高资源需求且不承诺任何自动上限,
    /// 因此无上界的请求等于依赖一种只在单台模拟器上观察到的自我限制行为;
    /// 蜂窝网络下多下载的部分花的是用户的流量.
    /// 若真机数据支持更大的值, 调整它只是改一行.
    static let preferredForwardBufferDuration: TimeInterval = 180

    /// How far the forward buffer has to move before it is logged again.
    ///
    /// 前向缓冲需要变化多少才会再次记录.
    ///
    /// The buffer is read every second, and an entry keeps the sampled value whenever it
    /// differs from the last recorded one by at least this much in either direction. So a
    /// session leaves a short curve rather than one entry per second, and the last line is
    /// a real sample that can sit up to one step either side of where the buffer settled.
    /// A move that reverses inside the cooldown below can be skipped entirely.
    /// `isPlaybackBufferFull` cannot stand in for any of this: it reports AVFoundation's
    /// own internal buffer, and a measured session that grew to 91.6s never set it.
    ///
    /// 缓冲每秒读取一次, 当采样值相对上一条记录在任一方向上至少相差该值时, 便记录该采样值.
    /// 因此一段播放留下的是一条简短曲线而非每秒一条, 且最后一行是一个真实采样,
    /// 可能落在缓冲稳定值的上方或下方, 相差不超过一个步长.
    /// 在下方的冷却期内发生并反转的变化则可能被完全跳过.
    /// `isPlaybackBufferFull` 无法代替其中任何一点:
    /// 该属性反映的是 AVFoundation 自身的内部缓冲区, 而实测中增长到 91.6s 的那一组从未置位.
    private static let bufferLogStepSeconds: TimeInterval = 10

    /// Minimum number of one-second wall-clock samples between two buffer log entries.
    ///
    /// 两条缓冲日志之间至少间隔的一秒墙钟采样次数.
    ///
    /// The step alone does not bound volume: seeking makes the forward buffer collapse to
    /// zero and refill, and an alternation between 0 and 100 clears a 10s step on every
    /// single sample. This puts a ceiling on the rate that holds no matter how the value
    /// moves.
    ///
    /// 仅有步长无法限制日志量: seek 会让前向缓冲归零再重新填充,
    /// 而在 0 与 100 之间反复跳变时, 每一次采样都能跨过 10s 的步长.
    /// 这一项无论数值如何变化都为记录频率设定了上限.
    private static let bufferLogMinimumSamples = 5

    /// Wall-clock interval between two forward-buffer samples.
    ///
    /// 两次前向缓冲采样之间的墙钟间隔.
    private static let bufferSampleInterval: TimeInterval = 1

    private(set) var player: AVPlayer?
    private var lastLoggedBufferAhead: TimeInterval = -.greatestFiniteMagnitude
    private var samplesSinceBufferLog = Int.max
    private var bufferSampler: Timer?
    private let logger = Logger(subsystem: "com.mritd.kmtv", category: "playback")
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var errorObserver: NSObjectProtocol?
    private var timeJumpObserver: NSObjectProtocol?
    private var statusObservers: [NSKeyValueObservation] = []

    /// Starts or replaces playback with a resolved URL.
    ///
    /// 使用已解析的 URL 开始播放或替换当前播放项.
    func start(
        url: URL,
        startTime: TimeInterval,
        rate: Float,
        onTime: @escaping @MainActor @Sendable (TimeInterval, TimeInterval) -> Void,
        onBuffer: @escaping @MainActor @Sendable (BufferSample) -> Void,
        onEnd: @escaping @MainActor @Sendable () -> Void,
        onError: @escaping @MainActor @Sendable (String?) -> Void
    ) {
        removeObservers()
        // Each item starts its own buffer curve; without this the first entry for a new
        // episode is suppressed whenever it lands within a step of the old one's last.
        //
        // 每个 item 都从自己的缓冲曲线开始; 缺少这一行时, 新剧集的首条记录会在其数值
        // 落在上一集最后一条的一个步长以内时被抑制.
        lastLoggedBufferAhead = -.greatestFiniteMagnitude
        samplesSinceBufferLog = Int.max
        logger.info("coordinator.start url=\(url.absoluteString, privacy: .public) startTime=\(startTime, privacy: .public) rate=\(rate, privacy: .public)")
        let item = AVPlayerItem(url: url)
        // Set before the item is handed to a player, and on every item rather than only
        // the first, so switching episode or source keeps the same buffering ambition.
        //
        // 在把 item 交给 player 之前设置, 且每个 item 都设而非只设第一个,
        // 使切换剧集或换源后仍保持同样的缓冲目标.
        item.preferredForwardBufferDuration = Self.preferredForwardBufferDuration
        if let player {
            logger.info("coordinator.start replacing current item")
            player.replaceCurrentItem(with: item)
        } else {
            logger.info("coordinator.start creating AVPlayer")
            player = AVPlayer(playerItem: item)
        }
        setupObservers(for: item, onTime: onTime, onBuffer: onBuffer, onEnd: onEnd, onError: onError)
        if startTime > 0 {
            player?.seek(to: CMTime(seconds: startTime, preferredTimescale: 600))
        }
        player?.play()
        if rate != 1.0 {
            player?.rate = rate
        }
        logPlayerState("afterPlay", item: item)
    }

    func pause() {
        player?.pause()
    }

    func resume(rate: Float) {
        player?.play()
        if rate != 1.0 {
            player?.rate = rate
        }
    }

    func cleanup() {
        logger.info("coordinator.cleanup hasPlayer=\(self.player != nil, privacy: .public)")
        pause()
        removeObservers()
        player = nil
    }

    private func setupObservers(
        for item: AVPlayerItem,
        onTime: @escaping @MainActor @Sendable (TimeInterval, TimeInterval) -> Void,
        onBuffer: @escaping @MainActor @Sendable (BufferSample) -> Void,
        onEnd: @escaping @MainActor @Sendable () -> Void,
        onError: @escaping @MainActor @Sendable (String?) -> Void
    ) {
        guard let player else { return }
        logPlayerState("setupObservers", item: item)
        let interval = CMTime(seconds: 1, preferredTimescale: 600)
        // The time observer owns resume progress updates, so keep its cadence coarse.
        //
        // 时间观察器负责续播进度更新, 因此保持较低频率避免写入过密.
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            MainActor.assumeIsolated {
                let current = CMTimeGetSeconds(time)
                let total = CMTimeGetSeconds(self?.player?.currentItem?.duration ?? .zero)
                guard current.isFinite && total.isFinite && total > 0 else { return }
                onTime(current, total)
            }
        }
        // Wall-clock rather than the periodic time observer above: that one is driven by
        // the item's timeline, so it goes quiet exactly when the playhead stops — during
        // startup buffering, a stall, or a pause — which is the window the buffer curve is
        // most needed in.
        //
        // 用墙钟而非上面的周期时间观察器: 后者由 item 的时间轴驱动,
        // 播放头一停就随之静默 — 起播缓冲, 卡顿或暂停时都是如此 —
        // 而那恰恰是最需要缓冲曲线的窗口.
        bufferSampler = Self.scheduleBufferSampler(interval: Self.bufferSampleInterval) { [weak self] in
            MainActor.assumeIsolated { self?.sampleBuffer(onBuffer: onBuffer) }
        }
        // Any seek moves the playhead without warning, including one made from a control
        // this app does not own: fullscreen hands the scrubber to AVPlayerViewController.
        // Sampling on the jump means the reported buffer belongs to the new position at
        // once, rather than describing where playback used to be until the next tick.
        //
        // 任何 seek 都会毫无预兆地移动播放头, 包括来自本应用并不拥有的控件:
        // 全屏时进度条由 AVPlayerViewController 掌管.
        // 在跳转时立即采样, 可使上报的缓冲马上归属于新位置,
        // 而不是在下一次节拍到来前一直描述播放头原先所在之处.
        timeJumpObserver = NotificationCenter.default.addObserver(
            forName: AVPlayerItem.timeJumpedNotification,
            object: item,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.reportBuffer(onBuffer: onBuffer) }
        }
        setupStatusObservers(for: item, player: player)
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { _ in
            // AVFoundation callbacks arrive outside SwiftUI state flow; hop back to MainActor.
            //
            // AVFoundation 回调不属于 SwiftUI 状态流, 需要回到 MainActor.
            MainActor.assumeIsolated { self.logger.info("coordinator.endNotification") }
            MainActor.assumeIsolated { onEnd() }
        }
        errorObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemFailedToPlayToEndTime,
            object: item,
            queue: .main
        ) { notification in
            let message = (notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error)?.localizedDescription
            // Log before surfacing the error so black-screen diagnostics keep AVPlayer state.
            //
            // 上抛错误前先记录状态, 便于保留黑屏问题的 AVPlayer 证据.
            MainActor.assumeIsolated {
                self.logger.error("coordinator.errorNotification message=\(message ?? "unknown", privacy: .public)")
                self.logPlayerState("errorNotification", item: item)
            }
            MainActor.assumeIsolated { onError(message) }
        }
    }

    /// Observes AVFoundation playback state changes that do not surface through SwiftUI.
    ///
    /// 观察 SwiftUI 不会自动暴露的 AVFoundation 播放状态变化.
    private func setupStatusObservers(for item: AVPlayerItem, player: AVPlayer) {
        statusObservers = [
            item.observe(\.status, options: [.initial, .new]) { [weak self, weak item] _, _ in
                MainActor.assumeIsolated {
                    guard let self, let item else { return }
                    self.logPlayerState("item.status", item: item)
                }
            },
            item.observe(\.isPlaybackLikelyToKeepUp, options: [.initial, .new]) { [weak self, weak item] _, _ in
                MainActor.assumeIsolated {
                    guard let self, let item else { return }
                    self.logPlayerState("item.keepUp", item: item)
                }
            },
            item.observe(\.isPlaybackBufferEmpty, options: [.initial, .new]) { [weak self, weak item] _, _ in
                MainActor.assumeIsolated {
                    guard let self, let item else { return }
                    self.logPlayerState("item.bufferEmpty", item: item)
                }
            },
            // No observer for isPlaybackBufferFull: once the buffer settles AVFoundation
            // flips it as it drains and refills its internal buffer, and a measured 73s
            // session produced 55 of its 72 log entries from that one property alone —
            // about 2700 lines an hour, burying everything else. Its value is a field on
            // every line this method writes, so the observer only ever duplicated what the
            // other signals already carried.
            //
            // 不观察 isPlaybackBufferFull: 缓冲稳定后, AVFoundation 会随着内部缓冲区
            // 的消耗与回填反复翻转该属性, 实测 73 秒会话的 72 条日志中有 55 条
            // 仅出自这一个属性 — 约每小时 2700 条, 把其余信息全部淹没.
            // 它的值本就是本方法写出的每一行的固定字段, 因此该观察器始终只是在
            // 重复其他信号已经携带的内容.
            player.observe(\.timeControlStatus, options: [.initial, .new]) { [weak self, weak item] _, _ in
                MainActor.assumeIsolated {
                    guard let self, let item else { return }
                    self.logPlayerState("player.timeControlStatus", item: item)
                }
            },
        ]
    }

    /// Records the compact playback state needed to diagnose black-screen playback.
    ///
    /// 记录定位黑屏播放问题所需的精简播放状态.
    ///
    /// `bufferAhead` is here because stalling and "it never buffers" complaints are
    /// indistinguishable from the other fields alone: a full buffer and an empty one both
    /// report keepUp=true once playback settles.
    ///
    /// 记录 `bufferAhead` 是因为仅凭其余字段无法区分卡顿与"完全不缓冲"的反馈:
    /// 播放稳定后, 缓冲充足与缓冲很少都会报告 keepUp=true.
    private func logPlayerState(_ event: String, item: AVPlayerItem) {
        logger.info(
            "coordinator.state event=\(event, privacy: .public) itemStatus=\(Self.describeItemStatus(item.status), privacy: .public) timeControlStatus=\(Self.describeTimeControlStatus(self.player?.timeControlStatus), privacy: .public) keepUp=\(item.isPlaybackLikelyToKeepUp, privacy: .public) bufferEmpty=\(item.isPlaybackBufferEmpty, privacy: .public) bufferFull=\(item.isPlaybackBufferFull, privacy: .public) bufferAhead=\(Self.bufferAhead(of: item), privacy: .public) itemError=\(item.error?.localizedDescription ?? "none", privacy: .public) playerError=\(self.player?.error?.localizedDescription ?? "none", privacy: .public)"
        )
    }

    /// Reports the buffer to the UI on every sample, and to the log only when it moved a
    /// full step since the last entry.
    ///
    /// 每次采样都把缓冲量报告给 UI, 仅当相较上次记录移动了一个完整步长时才写日志.
    ///
    /// The two have opposite needs: the progress bar has to track every sample or it stops
    /// moving, while the log has to stay readable across a whole session. Only the log is
    /// throttled.
    ///
    /// 两者需求相反: 进度条必须跟上每一次采样, 否则就会停住不动,
    /// 而日志必须在整段会话中保持可读. 因此只对日志做节流.
    ///
    /// Reports the buffer to the UI without touching the log's cadence.
    ///
    /// 向 UI 上报缓冲, 不影响日志的节奏.
    ///
    /// Seeks arrive in bursts, so letting them advance the log's sample counter would make
    /// the minimum-samples rule a count of events rather than of seconds, and a scrub could
    /// clear a cooldown meant to span five of them.
    ///
    /// seek 会成串到达, 若让它们推进日志的采样计数,
    /// 最少采样次数就会变成事件计数而非秒数计数,
    /// 一次拖动便可能清掉本应跨越五秒的冷却.
    private func reportBuffer(onBuffer: @MainActor @Sendable (BufferSample) -> Void) {
        guard let item = player?.currentItem else { return }
        let ahead = Self.bufferAhead(of: item)
        onBuffer(BufferSample(end: Self.bufferedEnd(currentTime: item.currentTime(), ahead: ahead),
                              ahead: ahead))
    }

    private func sampleBuffer(onBuffer: @MainActor @Sendable (BufferSample) -> Void) {
        guard let item = player?.currentItem else { return }
        reportBuffer(onBuffer: onBuffer)
        let ahead = Self.bufferAhead(of: item)
        samplesSinceBufferLog = samplesSinceBufferLog == Int.max ? Int.max : samplesSinceBufferLog + 1
        guard Self.shouldLogBuffer(ahead: ahead,
                                   lastLogged: lastLoggedBufferAhead,
                                   samplesSinceLog: samplesSinceBufferLog) else { return }
        lastLoggedBufferAhead = ahead
        samplesSinceBufferLog = 0
        logPlayerState("buffer", item: item)
    }

    /// Position the buffer reaches on the timeline, as the progress bar needs it.
    ///
    /// 缓冲在时间轴上到达的位置, 即进度条所需要的形式.
    ///
    /// Measured from the playhead rather than taken from the furthest loaded range: after a
    /// seek, AVFoundation can still hold a range from before the jump, and drawing the bar
    /// out to that range would promise playable media the player would in fact have to
    /// re-fetch.
    ///
    /// 从播放头起算, 而不是取最远的已加载区间: seek 之后,
    /// AVFoundation 可能仍持有跳转前的区间, 把进度条画到那里
    /// 等于承诺了一段播放器实际上还需要重新拉取的可播放内容.
    static func bufferedEnd(currentTime: CMTime, ahead: TimeInterval) -> TimeInterval {
        let current = CMTimeGetSeconds(currentTime)
        guard current.isFinite else { return 0 }
        return current + ahead
    }

    /// Starts the repeating timer that samples the forward buffer.
    ///
    /// 启动周期性采样前向缓冲的定时器.
    ///
    /// Registered in the common run loop modes rather than through
    /// `Timer.scheduledTimer`, which only joins the default mode: the episode list sits in
    /// a `ScrollView` directly below the video, so scrolling it during playback puts the
    /// main run loop in tracking mode and a default-mode timer stops firing for the whole
    /// gesture — losing exactly the samples a "it stutters when I scroll" report needs.
    ///
    /// 注册到 common 运行循环模式, 而不是走只加入 default 模式的 `Timer.scheduledTimer`:
    /// 剧集列表位于视频正下方的 `ScrollView` 中, 播放中滚动它会让主运行循环进入 tracking 模式,
    /// default 模式的定时器在整个手势期间都不会触发 —
    /// 丢掉的恰好是"一滚动就卡"这类反馈所需要的采样.
    static func scheduleBufferSampler(interval: TimeInterval,
                                      onSample: @escaping @Sendable () -> Void) -> Timer {
        let timer = Timer(timeInterval: interval, repeats: true) { _ in onSample() }
        RunLoop.main.add(timer, forMode: .common)
        return timer
    }

    /// Whether this sample of the forward buffer is worth a log entry.
    ///
    /// 本次前向缓冲采样是否值得记录一条日志.
    ///
    /// Both conditions are needed: the step keeps a settled buffer silent, and the sample
    /// count keeps a buffer that swings across the step on every sample from logging at the
    /// observer's full rate.
    ///
    /// 两个条件缺一不可: 步长让已稳定的缓冲保持静默,
    /// 采样计数则让每次采样都跨越步长的剧烈波动无法以观察器的全速率写日志.
    static func shouldLogBuffer(ahead: TimeInterval, lastLogged: TimeInterval, samplesSinceLog: Int) -> Bool {
        guard samplesSinceLog >= bufferLogMinimumSamples else { return false }
        return abs(ahead - lastLogged) >= bufferLogStepSeconds
    }

    /// Seconds of continuous media buffered ahead of the playhead, or 0 when the playhead
    /// sits outside every loaded range.
    ///
    /// 播放头之前已连续缓冲的秒数; 播放头不在任何已加载区间内时为 0.
    static func bufferAhead(of item: AVPlayerItem) -> TimeInterval {
        bufferAhead(currentTime: item.currentTime(), in: item.loadedTimeRanges.map(\.timeRangeValue))
    }

    /// The calculation behind `bufferAhead(of:)`, split out so it can be tested against
    /// ranges an AVPlayerItem cannot be made to hold on demand: a playhead in a gap
    /// between two ranges, a live stream's indefinite duration, an empty list.
    ///
    /// `bufferAhead(of:)` 背后的计算, 单独拆出以便针对无法让 AVPlayerItem 按需持有的
    /// 区间进行测试: 播放头落在两个区间之间的空隙, 直播流的不确定时长, 空列表.
    static func bufferAhead(currentTime: CMTime, in ranges: [CMTimeRange]) -> TimeInterval {
        let current = CMTimeGetSeconds(currentTime)
        guard current.isFinite else { return 0 }
        return ranges.compactMap { range -> TimeInterval? in
            let start = CMTimeGetSeconds(range.start)
            let duration = CMTimeGetSeconds(range.duration)
            guard start.isFinite, duration.isFinite else { return nil }
            let end = start + duration
            guard start <= current, current <= end else { return nil }
            return end - current
        }.max() ?? 0
    }

    static func describeTimeControlStatus(_ status: AVPlayer.TimeControlStatus?) -> String {
        guard let status else { return "nil" }
        switch status {
        case .paused:
            return "paused"
        case .waitingToPlayAtSpecifiedRate:
            return "waitingToPlayAtSpecifiedRate"
        case .playing:
            return "playing"
        @unknown default:
            return "unknown"
        }
    }

    private static func describeItemStatus(_ status: AVPlayerItem.Status) -> String {
        switch status {
        case .unknown:
            return "unknown"
        case .readyToPlay:
            return "readyToPlay"
        case .failed:
            return "failed"
        @unknown default:
            return "unknown"
        }
    }

    private func removeObservers() {
        bufferSampler?.invalidate()
        bufferSampler = nil
        if let timeObserver {
            player?.removeTimeObserver(timeObserver)
        }
        timeObserver = nil
        // Dropping NSKeyValueObservation values unregisters the KVO observers.
        //
        // 释放 NSKeyValueObservation 即会注销对应 KVO observer.
        statusObservers.removeAll()
        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
        }
        endObserver = nil
        if let errorObserver {
            NotificationCenter.default.removeObserver(errorObserver)
        }
        errorObserver = nil
        if let timeJumpObserver {
            NotificationCenter.default.removeObserver(timeJumpObserver)
        }
        timeJumpObserver = nil
    }
}
