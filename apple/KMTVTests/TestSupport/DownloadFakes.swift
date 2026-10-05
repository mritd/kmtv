import Foundation
@testable import KMTV

/// In-memory transport: records requests, keeps live tasks, and finishes them on demand.
///
/// 内存中的传输层: 记录请求, 保存进行中的任务, 并按需让任务完成.
@MainActor
final class FakeDownloadTransport: DownloadTransport {
    var onEvent: (@MainActor (DownloadTransportEvent) async -> Void)?
    private(set) var enqueued: [DownloadTaskRequest] = []
    private(set) var cancelled: [DownloadTaskID] = []
    var live: [DownloadTaskID: DownloadTaskRequest] = [:]

    func enqueue(_ requests: [DownloadTaskRequest]) {
        enqueued += requests
        for request in requests { live[request.id] = request }
    }

    func cancel(where predicate: @escaping @Sendable (DownloadTaskID) -> Bool) async {
        for id in live.keys where predicate(id) {
            cancelled.append(id)
            live[id] = nil
        }
    }

    func outstanding() async -> [DownloadTaskID] { Array(live.keys) }

    func waitForBackgroundEvents() async {}

    func drainEvents() async {}

    /// Finishes a task (live or not) with a body and delivers the event.
    ///
    /// 以给定响应体完成一个任务 (无论是否仍在进行) 并投递事件.
    func finish(_ id: DownloadTaskID, layout: DownloadLayout, status: Int = 200,
                body: Data = Data([0x47, 0x40, 0x00, 0x10]), contentType: String? = "video/mp2t") async {
        let request = live.removeValue(forKey: id) ?? enqueued.last(where: { $0.id == id })
        let file = layout.incomingFile(id)
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? body.write(to: file)
        let url = request?.url ?? URL(string: "https://cdn.example/unknown")!
        await onEvent?(.finished(id, DownloadResponseInfo(url: url, status: status, contentType: contentType,
                                                          head: body.prefix(4096), size: Int64(body.count), file: file)))
    }

    /// Fails a task with a transport error and delivers the event.
    ///
    /// 以传输错误让任务失败并投递事件.
    func fail(_ id: DownloadTaskID, code: URLError.Code) async {
        live[id] = nil
        await onEvent?(.failed(id, code))
    }
}

/// Preparer that builds a proxied playlist of `segments[episodeURL]` (default 3) segments whose
/// URLs carry the generation, or throws `errors[episodeURL]`.
///
/// 准备器: 构建一个含 `segments[episodeURL]` 个分片 (默认 3 个) 的代理 playlist, 分片 URL 中带有
/// generation; 或抛出 `errors[episodeURL]`.
final class FakePreparer: DownloadPreparing, @unchecked Sendable {
    var segments: [String: Int] = [:]
    var errors: [String: DownloadPrepareError] = [:]
    /// When set, every prepare suspends until the test opens the gate.
    ///
    /// 设置后, 每次准备都会挂起, 直到测试打开该闸门.
    var gate: PrepareGate?
    private(set) var calls: [(episodeURL: String, generation: Int)] = []

    func prepare(episodeURL: String, sourceKey: String, generation: Int) async throws -> DownloadManifest {
        calls.append((episodeURL, generation))
        if let gate { await gate.wait() }
        if let error = errors[episodeURL] { throw error }
        var text = "#EXTM3U\n#EXT-X-TARGETDURATION:2\n"
        for index in 0..<(segments[episodeURL] ?? 3) {
            text += "#EXTINF:2,\nhttps://kmtv.example/api/v1/proxy/segment?url=\(index)&mt=g\(generation)\n"
        }
        text += "#EXT-X-ENDLIST\n"
        guard case .media(let media) = try HLSParser.parse(text, baseURL: URL(string: "https://kmtv.example/p.m3u8")!) else {
            throw DownloadPrepareError.format(.notHLS)
        }
        return DownloadManifest.build(from: media, generation: generation)
    }
}

/// A one-shot gate: `wait()` suspends until `open()` is called, and returns at once afterwards.
///
/// 一次性闸门: 调用 `open()` 之前 `wait()` 会挂起, 之后立即返回.
final class PrepareGate: @unchecked Sendable {
    private let lock = NSLock()
    private var isOpen = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    /// Suspends until the gate is open.
    ///
    /// 挂起直到闸门打开.
    func wait() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let resumeNow = lock.withLock {
                if isOpen { return true }
                waiters.append(continuation)
                return false
            }
            if resumeNow { continuation.resume() }
        }
    }

    /// Opens the gate and releases every waiter.
    ///
    /// 打开闸门并放行所有等待者.
    func open() {
        let released = lock.withLock {
            isOpen = true
            let released = waiters
            waiters = []
            return released
        }
        released.forEach { $0.resume() }
    }
}
