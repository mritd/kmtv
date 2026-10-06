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
    /// When set, the next `cancel` suspends before it looks at the tasks (like awaiting
    /// `session.allTasks`) until the test opens the gate; `cancelEntered` turns true once it waits.
    ///
    /// 设置后, 下一次 `cancel` 在查看任务之前挂起 (如同等待 `session.allTasks`), 直到测试打开闸门;
    /// 开始等待后 `cancelEntered` 变为 true.
    var cancelGate: PrepareGate?
    private(set) var cancelEntered = false
    /// When set, the next `outstanding` takes its snapshot and then suspends until the test opens
    /// the gate, like a reply computed on the session queue; `outstandingEntered` turns true once it
    /// waits.
    ///
    /// 设置后, 下一次 `outstanding` 先取快照再挂起, 直到测试打开闸门, 如同在 session 队列上算好的
    /// 回复; 开始等待后 `outstandingEntered` 变为 true.
    var outstandingGate: PrepareGate?
    private(set) var outstandingEntered = false

    func enqueue(_ requests: [DownloadTaskRequest]) {
        enqueued += requests
        for request in requests { live[request.id] = request }
    }

    func cancel(where predicate: @escaping @Sendable (DownloadTaskID) -> Bool) async {
        if let gate = cancelGate {
            cancelGate = nil
            cancelEntered = true
            await gate.wait()
        }
        for id in live.keys where predicate(id) {
            cancelled.append(id)
            live[id] = nil
        }
    }

    func outstanding() async -> [DownloadTaskID] {
        let snapshot = Array(live.keys)
        if let gate = outstandingGate {
            outstandingGate = nil
            outstandingEntered = true
            await gate.wait()
        }
        return snapshot
    }

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
/// URLs carry the generation, AES-128 encrypted when `encrypted` is set, or throws
/// `errors[episodeURL]`.
///
/// 准备器: 构建一个含 `segments[episodeURL]` 个分片 (默认 3 个) 的代理 playlist, 分片 URL 中带有
/// generation, 设置 `encrypted` 时使用 AES-128 加密; 或抛出 `errors[episodeURL]`.
final class FakePreparer: DownloadPreparing, @unchecked Sendable {
    var segments: [String: Int] = [:]
    var errors: [String: DownloadPrepareError] = [:]
    /// Whether playlists carry an AES-128 key, which becomes entry 0.
    ///
    /// playlist 是否带有 AES-128 key; 该 key 为第 0 个条目.
    var encrypted = false
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
        if encrypted {
            text += "#EXT-X-KEY:METHOD=AES-128,URI=\"https://kmtv.example/api/v1/proxy/key?url=k&mt=g\(generation)\"\n"
        }
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

/// A re-armable gate for the manager's progress wait: each `release()` lets one waiter through,
/// or the next one when nobody waits yet, so tests decide exactly when a progress tick fires.
///
/// 可重复使用的闸门, 用于管理器的进度等待: 每次 `release()` 放行一个等待者; 尚无等待者时放行下一个,
/// 因此测试可以精确决定进度通知何时发出.
final class TickGate: @unchecked Sendable {
    private let lock = NSLock()
    private var permits = 0
    private var waiters: [CheckedContinuation<Void, Never>] = []

    /// Suspends until released.
    ///
    /// 挂起直到被放行.
    func wait() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let resumeNow = lock.withLock {
                if permits > 0 {
                    permits -= 1
                    return true
                }
                waiters.append(continuation)
                return false
            }
            if resumeNow { continuation.resume() }
        }
    }

    /// Releases one waiter, or banks one release for the next wait.
    ///
    /// 放行一个等待者; 若尚无等待者, 则为下一次等待预留一次放行.
    func release() {
        let waiter: CheckedContinuation<Void, Never>? = lock.withLock {
            if waiters.isEmpty {
                permits += 1
                return nil
            }
            return waiters.removeFirst()
        }
        waiter?.resume()
    }
}

/// Free space for the manager, settable by tests and counting how often it is read.
///
/// 提供给管理器的剩余空间, 测试可以设置它, 并统计被读取的次数.
final class FreeSpaceStub: @unchecked Sendable {
    private let lock = NSLock()
    private var _value: Int64
    private var _reads = 0

    init(_ value: Int64) { _value = value }

    var value: Int64 {
        get { lock.withLock { _value } }
        set { lock.withLock { _value = newValue } }
    }

    var reads: Int { lock.withLock { _reads } }

    /// Reads the value and counts the read.
    ///
    /// 读取数值并计数.
    func read() -> Int64 {
        lock.withLock {
            _reads += 1
            return _value
        }
    }
}

/// Holds manifest writes on the writer's queue while closed, so tests can order a write against
/// other work; writes go to disk like the real writer once released.
///
/// 关闭时让 manifest 写入停在写入器的队列上, 使测试可以安排写入与其他操作的先后; 放行后与真实写入器
/// 一样写入磁盘.
final class WriteBlocker: @unchecked Sendable {
    private let lock = NSLock()
    private let semaphore = DispatchSemaphore(value: 0)
    private var closed = false
    private var _held = 0

    /// Writes waiting right now.
    ///
    /// 当前正在等待的写入数.
    var held: Int { lock.withLock { _held } }

    /// Makes later writes wait until `open()`.
    ///
    /// 让之后的写入等待 `open()`.
    func close() { lock.withLock { closed = true } }

    /// Releases every held write and lets later ones through.
    ///
    /// 放行所有被阻塞的写入, 之后的写入也直接通过.
    func open() {
        lock.withLock { closed = false }
        release()
    }

    /// Releases the writes held now; later ones still wait while closed.
    ///
    /// 放行当前被阻塞的写入; 仍处于关闭状态时, 之后的写入继续等待.
    func release() {
        let count = lock.withLock {
            let count = _held
            _held = 0
            return count
        }
        for _ in 0..<count { semaphore.signal() }
    }

    /// The writer for a manager under test.
    ///
    /// 供被测管理器使用的写入器.
    func writer() -> DownloadManifestWriter {
        DownloadManifestWriter(write: { [self] manifest, url in
            let hold = lock.withLock {
                if closed { _held += 1 }
                return closed
            }
            if hold { semaphore.wait() }
            try manifest.saveIntoExistingDirectory(at: url)
        })
    }
}
