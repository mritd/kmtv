import Foundation

/// Thread-safe token bridge for URLSession callbacks that cannot cross MainActor isolation.
/// 为不能跨越 MainActor 隔离的 URLSession 回调提供线程安全 token 桥接.
final class AccessTokenBox: @unchecked Sendable {
    private let lock = NSLock()
    private var value: String?

    /// Returns the current token under lock.
    /// 在锁保护下返回当前 token.
    func get() -> String? {
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    /// Replaces the current token under lock.
    /// 在锁保护下替换当前 token.
    func set(_ token: String?) {
        lock.lock()
        value = token
        lock.unlock()
    }
}
