#if os(iOS)
import Foundation

/// One download task to create.
///
/// 一个待创建的下载任务.
struct DownloadTaskRequest: Sendable, Equatable {
    let id: DownloadTaskID
    let url: URL
    let earliestBegin: Date?
    let priority: Float
    let allowsCellular: Bool
}

/// What a finished task returned; `file` is the body already moved out of the system's temp path.
///
/// 已完成任务返回的内容; `file` 是已从系统临时路径移出的响应体.
struct DownloadResponseInfo: Sendable, Equatable {
    let url: URL
    let status: Int
    let contentType: String?
    let head: Data
    let size: Int64
    let file: URL
}

/// Transport events, delivered in order.
///
/// 按顺序投递的传输事件.
enum DownloadTransportEvent: Sendable, Equatable {
    case finished(DownloadTaskID, DownloadResponseInfo)
    case failed(DownloadTaskID, URLError.Code)
    case storageFull(DownloadTaskID)
}

/// Creates, lists, and cancels download tasks; the background session in the app, a fake in tests.
///
/// 创建, 列出与取消下载任务; App 中是后台会话, 测试中是假实现.
@MainActor
protocol DownloadTransport: AnyObject {
    /// Receives events one at a time; the next event waits until this returns.
    ///
    /// 逐个接收事件; 下一个事件会等到本次处理返回后才投递.
    var onEvent: (@MainActor (DownloadTransportEvent) async -> Void)? { get set }
    /// Creates and resumes tasks without blocking the caller; `cancel` and `outstanding` see them.
    ///
    /// 创建并启动任务, 不阻塞调用方; `cancel` 与 `outstanding` 能看到这些任务.
    func enqueue(_ requests: [DownloadTaskRequest])
    /// Cancels matching tasks.
    ///
    /// 取消匹配的任务.
    func cancel(where predicate: @escaping @Sendable (DownloadTaskID) -> Bool) async
    /// IDs of tasks that have not finished.
    ///
    /// 尚未完成的任务 ID.
    func outstanding() async -> [DownloadTaskID]
    /// Returns once the system has delivered every event of a background relaunch.
    ///
    /// 系统投递完一次后台唤醒的所有事件后返回.
    func waitForBackgroundEvents() async
    /// Returns once every event yielded so far has been handled by `onEvent`.
    ///
    /// 目前已产生的所有事件都被 `onEvent` 处理完后返回.
    func drainEvents() async
}
#endif
