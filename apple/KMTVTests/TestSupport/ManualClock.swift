import Foundation

/// Mutable millisecond clock for tests that inject `now` closures.
///
/// 供注入 `now` 闭包的测试使用的可变毫秒时钟.
final class ManualClock: @unchecked Sendable {
    var nowMs: Int64

    init(_ nowMs: Int64 = 0) {
        self.nowMs = nowMs
    }

    /// Closure form for `now` parameters.
    ///
    /// 用于 `now` 参数的闭包形式.
    var now: @Sendable () -> Int64 { { self.nowMs } }
}
