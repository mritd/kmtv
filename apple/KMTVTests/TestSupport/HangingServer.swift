import Foundation
import Network

/// Loopback TCP listener that accepts connections and never answers, so an `AVPlayerItem` pointed
/// at it stays in `.unknown`, like a local item that never loads.
///
/// 运行在 loopback 上的 TCP listener, 接受连接但从不响应; 指向它的 `AVPlayerItem` 会一直停在
/// `.unknown`, 与始终无法加载的本地 item 相同.
final class HangingServer: @unchecked Sendable {
    private let lock = NSLock()
    private let queue = DispatchQueue(label: "com.mritd.kmtv.tests.hanging")
    private var listener: NWListener?
    private var connections: [NWConnection] = []

    /// Starts listening and returns a playlist URL on the listener's port.
    ///
    /// 开始监听并返回该端口上的 playlist URL.
    func start() async throws -> URL {
        let parameters = NWParameters.tcp
        parameters.requiredInterfaceType = .loopback
        let listener = try NWListener(using: parameters, on: .any)
        listener.newConnectionHandler = { [weak self] connection in
            guard let self else { return }
            lock.withLock { connections.append(connection) }
            connection.start(queue: queue)
        }
        listener.start(queue: queue)
        lock.withLock { self.listener = listener }
        for _ in 0..<100 {
            if case .ready = listener.state, let port = listener.port?.rawValue, port != 0 {
                return URL(string: "http://127.0.0.1:\(port)/hang/index.m3u8")!
            }
            try await Task.sleep(for: .milliseconds(20))
        }
        throw URLError(.cannotConnectToHost)
    }

    /// Closes the listener and every held connection.
    ///
    /// 关闭 listener 以及所有挂起的连接.
    func stop() {
        let (listener, connections) = lock.withLock { (self.listener, self.connections) }
        listener?.cancel()
        connections.forEach { $0.cancel() }
    }
}
