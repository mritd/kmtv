import Foundation

/// Server-aligned event clock. Event times from all devices follow server time, so
/// last-writer-wins compares like with like. Monotonicity is per record: callers pass the time
/// the new event must beat. There is no global high-water mark, so one bad server observation
/// cannot push every later write into the future.
///
/// 以服务器时间为基准的事件时钟. 所有设备的事件时间都跟随服务器时间, 让 "时间新的胜出" 规则
/// 比较的是同一把尺子. 单调性按记录保证: 调用方传入新事件必须超过的时间. 没有全局最大值,
/// 一次错误的服务端时间观测不会把之后所有写入都推到未来.
@MainActor
final class SyncClock {
    /// Current estimate of `server time - local time` in milliseconds.
    ///
    /// 当前估算的 `服务器时间 - 本地时间`, 单位毫秒.
    private(set) var offsetMs: Int64
    private let now: @Sendable () -> Int64

    init(offsetMs: Int64 = 0, now: @escaping @Sendable () -> Int64 = SyncClock.systemNowMs) {
        self.offsetMs = offsetMs
        self.now = now
    }

    /// Wall-clock milliseconds since 1970.
    ///
    /// 自 1970 年起的本地毫秒时间.
    nonisolated static func systemNowMs() -> Int64 {
        Int64((Date().timeIntervalSince1970 * 1000).rounded())
    }

    /// Returns the next event time: server-aligned now, or `after + 1` when that is later.
    ///
    /// 返回下一个事件时间: 对齐服务器的当前时间, 若 `after + 1` 更晚则返回它.
    func next(after: Int64 = 0) -> Int64 {
        max(now() + offsetMs, after + 1)
    }

    /// Learns the offset from a response, using the request midpoint as the server's moment.
    ///
    /// 从响应中学习时间差, 以请求往返的中点作为服务器时刻.
    func observe(serverTimeMs: Int64, sentAtMs: Int64, receivedAtMs: Int64) {
        guard serverTimeMs > 0, receivedAtMs >= sentAtMs else { return }
        offsetMs = serverTimeMs - (sentAtMs + receivedAtMs) / 2
    }
}
