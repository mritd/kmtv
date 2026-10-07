import Foundation

/// The screen the app shows at its root.
///
/// App 根部显示的页面.
enum AppState: Equatable {
    case loading
    case serverSetup
    case authenticated
    #if os(iOS)
    /// The device's downloads without a server. The identity, when known, records watch progress
    /// in its local store. iOS only: tvOS has no downloads.
    ///
    /// 不连接服务器时的本机下载. 已知身份时, 观看进度记录在其本地存储中. 仅 iOS: tvOS 没有下载.
    case offline(DownloadIdentity?)
    #endif
    case incompatibleServer(serverVersion: String, requiredVersion: String)
}

/// A change `AppSessionMachine` applies to the root state and the session epoch. Events that end
/// an async step carry the epoch the step started in, and apply only while it is still current.
///
/// `AppSessionMachine` 对根状态与会话纪元应用的变化. 结束某个异步步骤的事件携带该步骤开始时的纪元,
/// 只有该纪元仍是当前纪元时才会生效.
enum AppEvent: Equatable {
    /// Starts a new session epoch and keeps the screen: bootstrap, connect, logout, and opening
    /// offline begin with it, so a request still running for the previous session drops its result.
    ///
    /// 开始新的会话纪元并保持当前页面: 启动, 连接, 登出与打开离线模式都以它开始, 因此仍在为上一个
    /// 会话运行的请求会丢弃其结果.
    case beginSession
    /// Shows the connecting screen again before a bootstrap retries the server, for example from
    /// offline mode.
    ///
    /// 在启动流程重新尝试服务器之前再次显示连接页, 例如从离线模式重连.
    case reconnect
    /// The session at `epoch` needs a server: none is configured, or the bootstrap failed.
    ///
    /// 纪元为 `epoch` 的会话需要设置服务器: 尚未配置, 或启动失败.
    case needsSetup(epoch: Int)
    /// The session at `epoch` signed in.
    ///
    /// 纪元为 `epoch` 的会话已登录.
    case signedIn(epoch: Int)
    /// The server of the signed-in session at `epoch` is older than the app supports.
    ///
    /// 纪元为 `epoch` 的已登录会话所连接的服务端版本低于 App 的要求.
    case serverIncompatible(serverVersion: String, requiredVersion: String, epoch: Int)
    #if os(iOS)
    /// The session at `epoch` opens the device's downloads without the server.
    ///
    /// 纪元为 `epoch` 的会话不连接服务器, 打开本机下载.
    case wentOffline(DownloadIdentity?, epoch: Int)
    #endif
    /// Leaves the session for the setup screen: logout, disconnect, or a saved credential that
    /// expired. Always applies and starts a new epoch.
    ///
    /// 离开会话并回到设置页: 登出, 断开连接, 或已保存的凭据过期. 总是生效, 并开始新的纪元.
    case reset
    /// The server rejected the token in use. Like `reset`, except that offline mode stays: a late
    /// 401 from a bootstrap the user left for offline mode must not end it.
    ///
    /// 服务端拒绝了正在使用的 token. 与 `reset` 相同, 但离线模式保持不变: 用户已改为离线模式后,
    /// 被放弃的启动请求迟到的 401 不能结束离线模式.
    case sessionExpired
}

/// The transitions of the app's root state, as a pure value: `AppViewModel` sends an event at each
/// point where the screen changes and performs the side effects only when the event applied.
///
/// The session epoch identifies the current session. Every event that starts or leaves a session
/// bumps it, and the events that end an async step carry the epoch the step began in, so a request
/// that finishes for a session the user already left changes nothing.
///
/// App 根状态的转换, 以纯值类型表示: `AppViewModel` 在每个切换页面的位置发送事件, 只有事件生效时
/// 才执行副作用.
///
/// 会话纪元标识当前会话. 每个开始或离开会话的事件都会递增它, 结束异步步骤的事件携带该步骤开始时的
/// 纪元, 因此为用户已离开的会话完成的请求不会改变任何状态.
struct AppSessionMachine {
    private(set) var state: AppState = .loading
    private(set) var epoch = 0

    /// Whether `epoch` is the current session's.
    ///
    /// `epoch` 是否属于当前会话.
    func isCurrent(_ epoch: Int) -> Bool {
        epoch == self.epoch
    }

    /// Applies `event` and returns whether it applied; a rejected event changes nothing.
    ///
    /// 应用 `event` 并返回是否生效; 被拒绝的事件不会改变任何内容.
    @discardableResult
    mutating func send(_ event: AppEvent) -> Bool {
        switch event {
        case .beginSession:
            epoch += 1
        case .reconnect:
            state = .loading
        case .needsSetup(let at):
            guard isCurrent(at) else { return false }
            state = .serverSetup
        case .signedIn(let at):
            guard isCurrent(at) else { return false }
            state = .authenticated
        case .serverIncompatible(let serverVersion, let requiredVersion, let at):
            // Only a signed-in session checks its server's version.
            //
            // 只有已登录的会话才会检查服务端版本.
            guard isCurrent(at), state == .authenticated else { return false }
            state = .incompatibleServer(serverVersion: serverVersion, requiredVersion: requiredVersion)
        #if os(iOS)
        case .wentOffline(let identity, let at):
            guard isCurrent(at) else { return false }
            state = .offline(identity)
        #endif
        case .reset:
            epoch += 1
            state = .serverSetup
        case .sessionExpired:
            #if os(iOS)
            if case .offline = state { return false }
            #endif
            epoch += 1
            state = .serverSetup
        }
        return true
    }
}
