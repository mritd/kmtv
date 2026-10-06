#if os(iOS)
import Foundation
import os

/// Session delegate for background downloads. It runs on the session's serial queue, moves each
/// finished body synchronously (the system deletes it when the callback returns), and yields
/// ordered events to the transport.
///
/// 后台下载的 session delegate. 运行在 session 的串行队列上, 同步移动每个已完成的响应体 (回调返回后
/// 系统会删除它), 并向传输层按顺序发出事件.
final class DownloadSessionDelegate: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let layout: DownloadLayout
    private let continuation: AsyncStream<DownloadTransportEvent>.Continuation
    private let lock = NSLock()
    private var eventWaiters: [CheckedContinuation<Void, Never>] = []
    private var eventsFinished = false
    private var pendingEvents = 0
    private var drainWaiters: [CheckedContinuation<Void, Never>] = []

    init(layout: DownloadLayout, continuation: AsyncStream<DownloadTransportEvent>.Continuation) {
        self.layout = layout
        self.continuation = continuation
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        if let event = Self.handleFinished(description: downloadTask.taskDescription,
                                           requestURL: downloadTask.originalRequest?.url,
                                           response: downloadTask.response, location: location, layout: layout) {
            emit(event)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let event = Self.completionEvent(description: task.taskDescription, error: error) { emit(event) }
    }

    /// The event for a task that completed with an error; nil for success, cancellation, and
    /// foreign tasks. nsurlsessiond reports a full disk here (it cannot write or create the body
    /// file, or the error or its underlying error is ENOSPC), which pauses downloads instead of
    /// retrying. Any other error, in whatever domain, fails the task, so it never stays claimed.
    ///
    /// 任务以错误结束时对应的事件; 成功, 取消以及非本模块的任务返回 nil. nsurlsessiond 在此报告磁盘
    /// 已满 (无法写入或创建响应体文件, 或错误本身或其底层错误为 ENOSPC), 此时暂停下载而不是重试. 其他
    /// 任何域的错误都会让任务失败, 因此任务不会一直处于占用状态.
    static func completionEvent(description: String?, error: Error?) -> DownloadTransportEvent? {
        guard let error, let id = description.flatMap(DownloadTaskID.init(description:)) else { return nil }
        let nsError = error as NSError
        guard nsError.domain == NSURLErrorDomain else { return isOutOfSpace(error) ? .storageFull(id) : .failed(id, .unknown) }
        let code = URLError.Code(rawValue: nsError.code)
        if code == .cancelled { return nil }
        if code == .cannotWriteToFile || code == .cannotCreateFile || isOutOfSpace(error) { return .storageFull(id) }
        return .failed(id, code)
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        let waiters = lock.withLock {
            let waiters = eventWaiters
            eventWaiters = []
            if waiters.isEmpty { eventsFinished = true }
            return waiters
        }
        waiters.forEach { $0.resume() }
    }

    private func emit(_ event: DownloadTransportEvent) {
        lock.withLock { pendingEvents += 1 }
        continuation.yield(event)
    }

    /// Called by the transport after `onEvent` handled one event.
    ///
    /// 传输层在 `onEvent` 处理完一个事件后调用.
    func eventHandled() {
        let waiters: [CheckedContinuation<Void, Never>] = lock.withLock {
            pendingEvents = max(0, pendingEvents - 1)
            guard pendingEvents == 0 else { return [] }
            let waiters = drainWaiters
            drainWaiters = []
            return waiters
        }
        waiters.forEach { $0.resume() }
    }

    /// Returns once every yielded event has been handled.
    ///
    /// 所有已产生的事件都处理完后返回.
    func drain() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let resumeNow = lock.withLock {
                if pendingEvents == 0 { return true }
                drainWaiters.append(continuation)
                return false
            }
            if resumeNow { continuation.resume() }
        }
    }

    /// Returns once `urlSessionDidFinishEvents` has been called (immediately if it already was).
    ///
    /// `urlSessionDidFinishEvents` 被调用后返回 (若已调用过则立即返回).
    func waitForEvents() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let resumeNow = lock.withLock {
                if eventsFinished {
                    eventsFinished = false
                    return true
                }
                eventWaiters.append(continuation)
                return false
            }
            if resumeNow { continuation.resume() }
        }
    }

    /// Moves a finished body to the task's incoming file and describes the response. Error bodies
    /// are moved too, so the manager can read a media-token error. Returns nil for foreign tasks.
    ///
    /// 将已完成的响应体移到任务的 incoming 文件, 并描述该响应. 错误响应体同样会被移动, 以便管理器读取
    /// 媒体 token 错误. 非本模块的任务返回 nil.
    static func handleFinished(description: String?, requestURL: URL?, response: URLResponse?, location: URL,
                               layout: DownloadLayout) -> DownloadTransportEvent? {
        guard let id = description.flatMap(DownloadTaskID.init(description:)) else { return nil }
        let http = response as? HTTPURLResponse
        let size = Int64((try? location.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        var head = Data()
        if let handle = try? FileHandle(forReadingFrom: location) {
            head = (try? handle.read(upToCount: 4096)) ?? Data()
            try? handle.close()
        }
        let destination = layout.incomingFile(id)
        do {
            try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(),
                                                    withIntermediateDirectories: true)
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: location, to: destination)
        } catch {
            return isOutOfSpace(error) ? .storageFull(id) : .failed(id, .cannotMoveFile)
        }
        let url = http?.url ?? requestURL ?? destination
        return .finished(id, DownloadResponseInfo(url: requestURL ?? url, status: http?.statusCode ?? 0,
                                                  contentType: http?.value(forHTTPHeaderField: "Content-Type"),
                                                  head: head, size: size, file: destination))
    }

    /// Whether a file error means the disk is full.
    ///
    /// 文件错误是否表示磁盘已满.
    static func isOutOfSpace(_ error: Error) -> Bool {
        let nsError = error as NSError
        if nsError.domain == NSCocoaErrorDomain && nsError.code == NSFileWriteOutOfSpaceError { return true }
        if nsError.domain == NSPOSIXErrorDomain && nsError.code == Int(ENOSPC) { return true }
        if let underlying = nsError.userInfo[NSUnderlyingErrorKey] as? Error { return isOutOfSpace(underlying) }
        return false
    }
}

/// The app's background `URLSession`. Recreating it with the same identifier after a relaunch
/// reattaches to tasks the system kept running.
///
/// App 的后台 `URLSession`. 重启后用同一个 identifier 重建它, 即可重新接上系统持续运行的任务.
@MainActor
final class BackgroundDownloadTransport: DownloadTransport {
    static let identifier = "com.mritd.kmtv.downloads"

    var onEvent: (@MainActor (DownloadTransportEvent) async -> Void)?
    private let session: URLSession
    private let delegate: DownloadSessionDelegate
    private var consumer: Task<Void, Never>?
    /// Creates tasks off the main thread: each background task is a synchronous round trip to
    /// `nsurlsessiond`, and an episode can queue thousands at once. `cancel` and `outstanding`
    /// wait for it first, so they see every task enqueued before them.
    ///
    /// 在主线程之外创建任务: 每个后台任务都要与 `nsurlsessiond` 同步往返一次, 而一集可能一次加入
    /// 数千个任务. `cancel` 与 `outstanding` 会先等它完成, 因此能看到在它们之前加入的每个任务.
    private let submitQueue = DispatchQueue(label: "com.mritd.kmtv.downloads.submit", qos: .userInitiated)

    init(layout: DownloadLayout, identifier: String = BackgroundDownloadTransport.identifier) {
        let (stream, continuation) = AsyncStream.makeStream(of: DownloadTransportEvent.self)
        let delegate = DownloadSessionDelegate(layout: layout, continuation: continuation)
        let config = URLSessionConfiguration.background(withIdentifier: identifier)
        config.sessionSendsLaunchEvents = true
        config.isDiscretionary = false
        config.httpMaximumConnectionsPerHost = 6
        config.httpCookieAcceptPolicy = .never
        config.httpShouldSetCookies = false
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        self.delegate = delegate
        session = URLSession(configuration: config, delegate: delegate, delegateQueue: queue)
        consumer = Task { [weak self] in
            for await event in stream {
                await self?.onEvent?(event)
                delegate.eventHandled()
            }
        }
    }

    func enqueue(_ requests: [DownloadTaskRequest]) {
        let session = session
        submitQueue.async {
            for item in requests {
                var request = URLRequest(url: item.url)
                request.allowsCellularAccess = item.allowsCellular
                request.allowsExpensiveNetworkAccess = item.allowsCellular
                request.allowsConstrainedNetworkAccess = false
                let task = session.downloadTask(with: request)
                task.taskDescription = item.id.description
                task.earliestBeginDate = item.earliestBegin
                task.priority = item.priority
                task.resume()
            }
        }
    }

    /// Returns once every task enqueued so far exists in the session.
    ///
    /// 目前已加入的所有任务都已在会话中创建后返回.
    private func submitted() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            submitQueue.async { continuation.resume() }
        }
    }

    func cancel(where predicate: @escaping @Sendable (DownloadTaskID) -> Bool) async {
        await submitted()
        for task in await session.allTasks {
            if let id = task.taskDescription.flatMap(DownloadTaskID.init(description:)), predicate(id) {
                task.cancel()
            }
        }
    }

    func outstanding() async -> [DownloadTaskID] {
        await submitted()
        return await session.allTasks
            .filter { $0.state == .running || $0.state == .suspended }
            .compactMap { $0.taskDescription.flatMap(DownloadTaskID.init(description:)) }
    }

    func waitForBackgroundEvents() async {
        await delegate.waitForEvents()
    }

    func drainEvents() async {
        await delegate.drain()
    }
}
#endif
