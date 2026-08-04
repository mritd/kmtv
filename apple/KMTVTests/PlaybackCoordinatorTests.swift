import AVFoundation
import XCTest
@testable import KMTV

// The timer block is @Sendable, so the counter it writes cannot be MainActor-isolated
// even though every tick lands on the main thread.
//
// 定时器回调是 @Sendable 的, 因此它写入的计数器无法标注为 MainActor 隔离,
// 尽管每次触发实际都发生在主线程上.
private final class TickCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0

    var count: Int { lock.withLock { value } }

    func bump() { lock.withLock { value += 1 } }
}

@MainActor
final class PlaybackCoordinatorTests: XCTestCase {
    func testStartCreatesPlayerAndCleanupReleasesIt() {
        let coordinator = PlaybackCoordinator()
        let url = URL(string: "https://media.example/video.m3u8")!

        coordinator.start(
            url: url,
            startTime: 0,
            rate: 1.0,
            onTime: { _, _ in },
            onBuffer: { _ in },
            onEnd: {},
            onError: { _ in }
        )

        XCTAssertNotNil(coordinator.player)

        coordinator.cleanup()

        XCTAssertNil(coordinator.player)
    }

    // AVPlayer's automatic policy stopped pre-buffering at 21.9s on an iOS 26.1 simulator,
    // against 91.6s for the same stream with this value, which is what made playback feel
    // like it never buffered. The request has to reach the item itself; asserting only the
    // constant would pass even if the assignment were dropped.
    //
    // 在 iOS 26.1 模拟器上, AVPlayer 的自动策略在 21.9s 处停止预缓冲,
    // 而同一条流在此值下达到 91.6s, 这正是"感觉从不缓冲"的由来.
    // 该请求必须真正落到 item 上; 只断言常量的话, 即便赋值被删掉测试依然会通过.
    func testStartRequestsAFullForwardBuffer() {
        let coordinator = PlaybackCoordinator()

        coordinator.start(
            url: URL(string: "https://media.example/video.m3u8")!,
            startTime: 0,
            rate: 1.0,
            onTime: { _, _ in },
            onBuffer: { _ in },
            onEnd: {},
            onError: { _ in }
        )

        XCTAssertEqual(coordinator.player?.currentItem?.preferredForwardBufferDuration, 180)
        XCTAssertEqual(PlaybackCoordinator.preferredForwardBufferDuration, 180)

        coordinator.cleanup()
    }

    // Switching episode or source reuses the existing AVPlayer through replaceCurrentItem,
    // so a setting applied only where the player is first created would silently revert to
    // the automatic policy from the second episode onwards.
    //
    // 切换剧集或换源会经由 replaceCurrentItem 复用既有 AVPlayer,
    // 因此若只在首次创建 player 处设置, 从第二集起就会悄悄退回自动策略.
    func testReplacementItemKeepsTheForwardBufferRequest() {
        let coordinator = PlaybackCoordinator()

        coordinator.start(url: URL(string: "https://media.example/ep1.m3u8")!, startTime: 0, rate: 1.0,
                          onTime: { _, _ in }, onBuffer: { _ in }, onEnd: {}, onError: { _ in })
        let first = coordinator.player
        coordinator.start(url: URL(string: "https://media.example/ep2.m3u8")!, startTime: 0, rate: 1.0,
                          onTime: { _, _ in }, onBuffer: { _ in }, onEnd: {}, onError: { _ in })

        XCTAssertTrue(first === coordinator.player, "second start should reuse the player")
        XCTAssertEqual(coordinator.player?.currentItem?.preferredForwardBufferDuration, 180)

        coordinator.cleanup()
    }

    // bufferAhead feeds the diagnostic log, and every case below is one an AVPlayerItem
    // cannot be made to hold on demand: a gap between ranges after seeking, a live
    // stream's indefinite duration, a playhead sitting exactly on a boundary.
    //
    // bufferAhead 用于诊断日志, 下列每种情况都无法让 AVPlayerItem 按需持有:
    // seek 之后区间之间的空隙, 直播流的不确定时长, 播放头恰好落在边界上.
    func testBufferAheadCases() {
        func range(_ start: Double, _ duration: Double) -> CMTimeRange {
            CMTimeRange(start: CMTime(seconds: start, preferredTimescale: 600),
                        duration: CMTime(seconds: duration, preferredTimescale: 600))
        }
        func ahead(_ current: Double, _ ranges: [CMTimeRange]) -> TimeInterval {
            PlaybackCoordinator.bufferAhead(currentTime: CMTime(seconds: current, preferredTimescale: 600),
                                           in: ranges)
        }

        XCTAssertEqual(ahead(10, [range(0, 60)]), 50, accuracy: 0.01, "inside a range")
        XCTAssertEqual(ahead(0, [range(0, 60)]), 60, accuracy: 0.01, "on the start boundary")
        XCTAssertEqual(ahead(60, [range(0, 60)]), 0, accuracy: 0.01, "on the end boundary")
        XCTAssertEqual(ahead(90, [range(0, 60), range(120, 30)]), 0, accuracy: 0.01, "in the gap")
        XCTAssertEqual(ahead(130, [range(0, 60), range(120, 30)]), 20, accuracy: 0.01, "in the later range")
        XCTAssertEqual(ahead(10, []), 0, accuracy: 0.01, "nothing loaded")
        XCTAssertEqual(
            PlaybackCoordinator.bufferAhead(currentTime: .indefinite, in: [range(0, 60)]),
            0, accuracy: 0.01, "indefinite playhead"
        )
        XCTAssertEqual(
            ahead(10, [CMTimeRange(start: CMTime(seconds: 0, preferredTimescale: 600), duration: .indefinite)]),
            0, accuracy: 0.01, "indefinite range duration"
        )
        XCTAssertEqual(ahead(10, [range(0, -60)]), 0, accuracy: 0.01, "negative duration")
        XCTAssertEqual(
            ahead(10, [CMTimeRange(start: CMTime(value: 0, timescale: 0), duration: CMTime(value: 60, timescale: 0))]),
            0, accuracy: 0.01, "zero timescale is an invalid CMTime"
        )
    }

    // The throttle has to survive the two shapes real playback produces: a buffer that
    // grows and then settles, and one that collapses to zero and refills on every seek.
    // The second is what makes the step alone insufficient — each swing clears it.
    //
    // 该节流必须应对真实播放中的两种形态: 先增长后稳定的缓冲,
    // 以及每次 seek 都归零再重新填充的缓冲.
    // 后者正是仅有步长不够用的原因 — 每一次摆动都能跨过它.
    func testShouldLogBufferThrottling() {
        let step = 10.0
        let minSamples = 5

        // A first sample after start, where lastLogged is the sentinel, always logs.
        //
        // start 之后的首次采样, lastLogged 为哨兵值, 总会记录.
        XCTAssertTrue(PlaybackCoordinator.shouldLogBuffer(
            ahead: 0, lastLogged: -.greatestFiniteMagnitude, samplesSinceLog: Int.max))

        // Growth below one step stays silent, which is why a settled buffer stops logging.
        //
        // 增长不足一个步长时保持静默, 这正是缓冲稳定后不再记录的原因.
        XCTAssertFalse(PlaybackCoordinator.shouldLogBuffer(
            ahead: 100 + step - 0.1, lastLogged: 100, samplesSinceLog: 100))
        XCTAssertTrue(PlaybackCoordinator.shouldLogBuffer(
            ahead: 100 + step, lastLogged: 100, samplesSinceLog: 100))

        // Shrinking counts the same as growing; a collapse is worth recording.
        //
        // 收缩与增长同等对待; 缓冲塌陷同样值得记录.
        XCTAssertTrue(PlaybackCoordinator.shouldLogBuffer(
            ahead: 0, lastLogged: 100, samplesSinceLog: 100))

        // A 0-to-100 swing on every sample is rate-limited rather than logged each time.
        //
        // 每次采样都在 0 与 100 之间摆动时会被限速, 而不是每次都记录.
        for samples in 0..<minSamples {
            XCTAssertFalse(PlaybackCoordinator.shouldLogBuffer(
                ahead: samples.isMultiple(of: 2) ? 0 : 100, lastLogged: 100, samplesSinceLog: samples),
                "a swing \(samples) samples after the last entry must stay silent")
        }
        XCTAssertTrue(PlaybackCoordinator.shouldLogBuffer(
            ahead: 0, lastLogged: 100, samplesSinceLog: minSamples))
    }

    // The episode list under the video is a ScrollView, so scrolling during playback is
    // ordinary use — and it drives the main run loop into tracking mode. Pumping the run
    // loop in that mode alone is what separates a common-mode timer from the default-mode
    // one Timer.scheduledTimer creates.
    //
    // 视频下方的剧集列表是一个 ScrollView, 播放中滚动它属于常规操作,
    // 而这会让主运行循环进入 tracking 模式.
    // 仅在该模式下泵运行循环, 正是区分 common 模式定时器与
    // Timer.scheduledTimer 所创建的 default 模式定时器的手段.
    func testBufferSamplerKeepsFiringWhileAScrollIsTracking() {
        let ticks = TickCounter()
        let timer = PlaybackCoordinator.scheduleBufferSampler(interval: 0.01) { ticks.bump() }
        defer { timer.invalidate() }

        let deadline = Date().addingTimeInterval(2)
        while ticks.count == 0, Date() < deadline {
            RunLoop.current.run(mode: .tracking, before: Date().addingTimeInterval(0.05))
        }

        XCTAssertGreaterThan(ticks.count, 0, "sampler must keep firing while a scroll is tracking")
    }

    // The bar is drawn from the playhead forward. Taking the furthest loaded range instead
    // would, right after a seek, paint over media the player still has to re-fetch.
    //
    // 进度条自播放头向前绘制. 若改取最远的已加载区间,
    // 则刚 seek 之后会把播放器仍需重新拉取的部分也画成已缓冲.
    func testBufferedEndIsMeasuredFromThePlayhead() {
        let at = { (seconds: Double) in CMTime(seconds: seconds, preferredTimescale: 600) }

        XCTAssertEqual(PlaybackCoordinator.bufferedEnd(currentTime: at(30), ahead: 90), 120, accuracy: 0.01)
        XCTAssertEqual(PlaybackCoordinator.bufferedEnd(currentTime: at(0), ahead: 0), 0, accuracy: 0.01)
        XCTAssertEqual(PlaybackCoordinator.bufferedEnd(currentTime: .indefinite, ahead: 90), 0, accuracy: 0.01,
                       "a live stream's indefinite playhead cannot produce a position")
    }

    // Fullscreen hands the scrubber to AVPlayerViewController, which seeks the AVPlayer
    // directly — no app code runs. Without sampling on the jump, the buffer reported after
    // such a seek still describes the old playhead until the next wall-clock tick.
    //
    // 全屏把进度条交给 AVPlayerViewController, 它会直接 seek AVPlayer, 不经过任何应用代码.
    // 若不在跳转时采样, 这类 seek 之后上报的缓冲在下一次墙钟节拍到来前
    // 描述的仍是旧播放头.
    func testASeekFromOutsideTheAppReportsTheBufferAtOnce() {
        let coordinator = PlaybackCoordinator()
        let samples = TickCounter()

        coordinator.start(url: URL(string: "https://media.example/ep1.m3u8")!, startTime: 0, rate: 1.0,
                          onTime: { _, _ in }, onBuffer: { _ in samples.bump() },
                          onEnd: {}, onError: { _ in })
        let firstItem = coordinator.player?.currentItem
        let before = samples.count

        NotificationCenter.default.post(name: AVPlayerItem.timeJumpedNotification, object: firstItem)
        XCTAssertGreaterThan(samples.count, before, "a time jump must produce a sample of its own")

        // Switching episode has to take the previous item's observer with it. Asserting this
        // after cleanup would prove nothing: the player is nil by then, so the sample is
        // dropped by its own guard whether or not the observer survived.
        //
        // 切换剧集必须一并带走上一个 item 的观察器.
        // 在 cleanup 之后断言则毫无意义: 那时 player 已为 nil,
        // 无论观察器是否残留, 采样都会被自身的守卫丢弃.
        coordinator.start(url: URL(string: "https://media.example/ep2.m3u8")!, startTime: 0, rate: 1.0,
                          onTime: { _, _ in }, onBuffer: { _ in samples.bump() },
                          onEnd: {}, onError: { _ in })
        let afterSwitch = samples.count

        NotificationCenter.default.post(name: AVPlayerItem.timeJumpedNotification, object: firstItem)
        XCTAssertEqual(samples.count, afterSwitch, "the previous item's observer must be gone")

        NotificationCenter.default.post(name: AVPlayerItem.timeJumpedNotification,
                                        object: coordinator.player?.currentItem)
        XCTAssertGreaterThan(samples.count, afterSwitch, "the current item still reports")

        coordinator.cleanup()
    }

    func testBufferAheadIsZeroForAFreshItem() {
        let item = AVPlayerItem(url: URL(string: "https://media.example/video.m3u8")!)

        XCTAssertEqual(PlaybackCoordinator.bufferAhead(of: item), 0)
    }
}
