import Foundation

/// What the app view model needs from downloads, so it compiles on every platform and tests can
/// use a fake.
///
/// App 视图模型需要的下载能力; 借此在所有平台上都能编译, 测试中也可以使用假实现.
@MainActor
protocol DownloadScopeControlling: AnyObject {
    /// The scope whose downloads are shown, signed in or offline; nil when none is.
    ///
    /// 正在展示其下载的作用域 (已登录或离线); 没有时为 nil.
    var activeScopeKey: String? { get }
    func activate(scopeKey: String, preparer: any DownloadPreparing) async
    func openOffline(scopeKey: String)
    func deactivate() async
    /// Queues `deactivate` at once without waiting for it; see `DownloadManager.beginDeactivate()`.
    ///
    /// 立即排入 `deactivate` 而不等待其完成; 参见 `DownloadManager.beginDeactivate()`.
    @discardableResult
    func beginDeactivate() -> Task<Void, Never>
    func deleteScope(_ scopeKey: String) async
    /// Whether the device has any completed download, whatever its server or account.
    ///
    /// 本机是否有任何已完成的下载, 无论其服务器或账号.
    var hasCompletedDownloads: Bool { get }
}
