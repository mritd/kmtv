#if os(iOS)
import Foundation
import Network
import os

/// One HTTP response produced by the loopback media server.
///
/// loopback 媒体服务生成的一个 HTTP 响应.
struct LocalMediaResponse: Sendable, Equatable {
    let status: Int
    let contentType: String
    let body: Data
}

/// Errors from starting the loopback media server.
///
/// 启动 loopback 媒体服务时的错误.
enum LocalMediaServerError: Error {
    case notReady
}

/// Maps one request head to a response: only `GET /<secret>/<relative path>` for a regular file
/// under `root` succeeds. Pure apart from reading the file, so it is tested without sockets.
///
/// 将一个请求头映射为响应: 只有指向 `root` 下普通文件的 `GET /<secret>/<相对路径>` 才会成功.
/// 除读取文件外没有副作用, 因此可以不经 socket 直接测试.
struct LocalMediaRequestHandler: Sendable {
    let root: URL
    let secret: String

    /// Builds the response for a raw request head (request line plus headers).
    ///
    /// 为原始请求头 (请求行加头部) 生成响应.
    func response(forRequestHead head: String) -> LocalMediaResponse {
        let requestLine = head.split(separator: "\r\n", maxSplits: 1).first.map(String.init) ?? ""
        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2 else { return Self.status(400) }
        guard parts[0] == "GET" else { return Self.status(405) }
        guard let file = resolve(String(parts[1])),
              let body = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            return Self.status(404)
        }
        return LocalMediaResponse(status: 200, contentType: Self.contentType(for: file), body: body)
    }

    /// Resolves a request target to a file under `root`, or nil when the secret is missing, a
    /// segment is `.` or `..` after percent-decoding, or the resolved path (symlinks followed)
    /// leaves `root`.
    ///
    /// 将请求目标解析为 `root` 下的文件. 缺少密钥, percent 解码后存在 `.` 或 `..` 段, 或解析软链接
    /// 后的路径离开 `root` 时返回 nil.
    func resolve(_ target: String) -> URL? {
        let pathPart = target.split(separator: "?", maxSplits: 1).first.map(String.init) ?? ""
        guard let decoded = pathPart.removingPercentEncoding else { return nil }
        let segments = decoded.split(separator: "/").map(String.init)
        guard segments.count >= 2, segments[0] == secret else { return nil }
        let relative = segments.dropFirst()
        guard !relative.contains(where: { $0 == "." || $0 == ".." }) else { return nil }
        let candidate = relative.reduce(root) { $0.appending(path: $1) }
        let rootPath = root.resolvingSymlinksInPath().standardizedFileURL.path
        let resolved = candidate.resolvingSymlinksInPath().standardizedFileURL
        guard resolved.path.hasPrefix(rootPath + "/") else { return nil }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: resolved.path, isDirectory: &isDirectory),
              !isDirectory.boolValue else { return nil }
        return resolved
    }

    /// Content type by file extension; downloaded entries are named by kind, not by upstream name.
    ///
    /// 按文件扩展名返回 content type; 下载的条目按类型命名, 而非沿用上游名称.
    static func contentType(for file: URL) -> String {
        switch file.pathExtension.lowercased() {
        case "m3u8": "application/vnd.apple.mpegurl"
        case "ts": "video/mp2t"
        case "mp4", "m4s": "video/mp4"
        default: "application/octet-stream"
        }
    }

    private static func status(_ code: Int) -> LocalMediaResponse {
        LocalMediaResponse(status: code, contentType: "text/plain", body: Data())
    }

    /// Reads one request from the connection, answers it, and closes the connection.
    ///
    /// 从连接读取一个请求, 返回响应后关闭连接.
    func serve(_ connection: NWConnection, on queue: DispatchQueue) {
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16 * 1024) { data, _, _, _ in
            let head = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            let response = self.response(forRequestHead: head)
            let reason = response.status == 200 ? "OK" : "Error"
            let header = Data("HTTP/1.1 \(response.status) \(reason)\r\nContent-Type: \(response.contentType)\r\nContent-Length: \(response.body.count)\r\nConnection: close\r\n\r\n".utf8)
            // Two sends, so the mapped body is never copied into one buffer with the header.
            //
            // 分两次发送, 映射的响应体因此不会与响应头一起被复制到同一个缓冲区.
            connection.send(content: header, isComplete: false, completion: .idempotent)
            connection.send(content: response.body, isComplete: true,
                            completion: .contentProcessed { _ in connection.cancel() })
        }
    }
}

/// Read-only HTTP/1.1 server on the loopback interface that hands downloaded HLS files to
/// AVPlayer, which cannot play file-based HLS. Every URL starts with a random per-launch secret,
/// so other apps on the device cannot read downloads by guessing the port.
///
/// 运行在 loopback 接口上的只读 HTTP/1.1 服务, 把下载好的 HLS 文件提供给无法播放文件形式 HLS
/// 的 AVPlayer. 每个 URL 都以每次启动随机生成的密钥开头, 设备上的其他 App 无法靠猜端口读取下载内容.
@MainActor
final class LocalMediaServer {
    let root: URL
    let secret: String
    private(set) var port: UInt16 = 0
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "com.mritd.kmtv.local-media")
    private let logger = Logger(subsystem: "com.mritd.kmtv", category: "downloads")

    init(root: URL, secret: String = LocalMediaServer.makeSecret()) {
        self.root = root
        self.secret = secret
    }

    /// A random 32-character hex secret.
    ///
    /// 32 个字符的随机十六进制密钥.
    nonisolated static func makeSecret() -> String {
        (0..<16).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    }

    /// Starts the listener when it is not ready and returns its port. A restart asks for the
    /// previous port, so URLs already handed to a player keep working after the app was suspended.
    /// `NWListener.port` reads 0 until the state is ready, so this waits for `.ready`.
    ///
    /// listener 未就绪时启动它并返回端口. 重启时会请求上一次的端口, 因此 App 挂起后, 已交给播放器的
    /// URL 仍然可用. `NWListener.port` 在就绪前读到的是 0, 所以这里会等待 `.ready`.
    func start() async throws -> UInt16 {
        if let listener, case .ready = listener.state, port != 0 { return port }
        listener?.cancel()
        let parameters = NWParameters.tcp
        parameters.requiredInterfaceType = .loopback
        parameters.allowLocalEndpointReuse = true
        if port != 0, let ready = try? await listen(on: NWEndpoint.Port(rawValue: port) ?? .any, parameters: parameters) {
            return ready
        }
        // The previous port is taken or refused: take any port. Players rebuild items on the new URL.
        //
        // 原端口已被占用或被拒绝: 改用任意端口. 播放器会基于新 URL 重建 item.
        return try await listen(on: .any, parameters: parameters)
    }

    private func listen(on requested: NWEndpoint.Port, parameters: NWParameters) async throws -> UInt16 {
        listener?.cancel()
        let listener = try NWListener(using: parameters, on: requested)
        let handler = LocalMediaRequestHandler(root: root, secret: secret)
        let queue = queue
        listener.newConnectionHandler = { connection in handler.serve(connection, on: queue) }
        listener.start(queue: queue)
        self.listener = listener
        for _ in 0..<100 {
            if case .ready = listener.state { break }
            if case .failed(let error) = listener.state { throw error }
            try await Task.sleep(for: .milliseconds(20))
        }
        guard case .ready = listener.state, let ready = listener.port?.rawValue, ready != 0 else {
            logger.error("local media server not ready state=\(String(describing: listener.state), privacy: .public)")
            throw LocalMediaServerError.notReady
        }
        port = ready
        return ready
    }

    /// Stops the listener; the port is remembered for the next start.
    ///
    /// 停止 listener; 端口会保留给下一次启动使用.
    func stop() {
        listener?.cancel()
        listener = nil
    }

    /// The loopback URL of a path relative to `root`.
    ///
    /// `root` 下某个相对路径对应的 loopback URL.
    func url(forRelativePath path: String) -> URL? {
        guard port != 0 else { return nil }
        return URL(string: "http://127.0.0.1:\(port)/\(secret)/\(path)")
    }
}
#endif
