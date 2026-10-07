import Foundation
import SwiftData
import SwiftUI

/// Classifies why `me()` failed at launch.
///
/// 判断启动时 `me()` 失败的原因.
enum BootstrapFailure {
    /// Whether the failure means the server could not be reached: a transport error, a gateway
    /// error (5xx), or a response that is not the API's JSON (for example a captive portal page).
    /// Cancellation and API errors such as 401 are not.
    ///
    /// 失败是否表示无法连接服务器: 传输错误, 网关错误 (5xx), 或不是 API JSON 的响应 (例如 captive
    /// portal 页面). 取消以及 401 等 API 错误不算.
    static func isUnreachable(_ error: Error) -> Bool {
        if let urlError = error as? URLError { return urlError.code != .cancelled }
        switch error as? APIError {
        case .networkError(let inner):
            return (inner as? URLError)?.code != .cancelled
        case .serverError(let status, _, _):
            return (500..<600).contains(status)
        case .decodingError:
            return true
        default:
            return false
        }
    }
}

/// Runs `operation` and fails with `URLError(.timedOut)` once `timeout` passes. Both run as child
/// tasks, so cancelling the caller cancels the request too, and a cancelled caller always gets
/// `CancellationError`, whatever the request threw.
///
/// 运行 `operation`, 超过 `timeout` 后以 `URLError(.timedOut)` 失败. 两者都作为子任务运行, 因此取消
/// 调用方也会取消请求; 调用方被取消时总是得到 `CancellationError`, 不论请求抛出了什么.
func withTimeout<T: Sendable>(_ timeout: Duration,
                              operation: @escaping @Sendable () async throws -> T) async throws -> T {
    do {
        return try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask(operation: operation)
            group.addTask {
                try await Task.sleep(for: timeout)
                throw URLError(.timedOut)
            }
            defer { group.cancelAll() }
            guard let result = try await group.next() else { throw CancellationError() }
            return result
        }
    } catch {
        try Task.checkCancellation()
        throw error
    }
}

/// A block observer of the default notification center that is removed when this object is released.
///
/// 默认通知中心上的 block 观察者, 本对象释放时自动移除.
final class NotificationObservation {
    private let token: any NSObjectProtocol

    init(_ name: Notification.Name, using block: @escaping @Sendable (Notification) -> Void) {
        token = NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main, using: block)
    }

    deinit {
        NotificationCenter.default.removeObserver(token)
    }
}

@Observable
@MainActor
final class AppViewModel {
    /// The root screen; it changes only through `send(_:)`.
    ///
    /// 根页面; 只通过 `send(_:)` 改变.
    private(set) var state: AppState = .loading

    /// The state transitions and the session epoch. Not observed: views watch `state`, so a new
    /// epoch alone never re-renders the root.
    ///
    /// 状态转换与会话纪元. 不参与观察: 视图观察的是 `state`, 因此单纯的新纪元不会让根视图重新渲染.
    @ObservationIgnored private var machine = AppSessionMachine()

    /// The signed-in user; profile edits replace it.
    ///
    /// 当前登录用户; 修改个人资料时会被替换.
    var currentUser: User?
    private(set) var apiClient: APIClient?
    private(set) var serverVersion: String = ""

    /// Sync store and engine of the current identity; nil until authenticated.
    ///
    /// 当前身份的同步存储与引擎; 认证前为 nil.
    private(set) var sync: SyncSession?

    private var modelContext: ModelContext
    private let session: URLSession?

    private let accessTokenBox = AccessTokenBox()
    private var authStore: AuthStore?
    @ObservationIgnored private var authObserver: NotificationObservation?

    /// Download scope control; nil on tvOS and in tests that do not cover downloads.
    ///
    /// 下载作用域控制; 在 tvOS 以及不涉及下载的测试中为 nil.
    private(set) var downloads: (any DownloadScopeControlling)?
    private let identityStore: LastIdentityStore
    private let toasts: any ToastPresenting

    /// How long `bootstrap()` waits for `me()` before treating the server as unreachable; tests lower it.
    ///
    /// `bootstrap()` 等待 `me()` 的时长, 超时后视为服务器不可达; 测试会调低该值.
    var bootstrapTimeout: Duration = .seconds(5)

    /// How long `connectServer` waits for the server before it fails with `URLError(.timedOut)`;
    /// tests lower it.
    ///
    /// `connectServer` 等待服务器的时长, 超时后以 `URLError(.timedOut)` 失败; 测试会调低该值.
    var connectTimeout: Duration = .seconds(10)

    /// `session` replaces the API client's URL session; tests pass a stubbed one. `toasts` shows
    /// session messages, and the sync session's, so tests can assert them through a fake.
    ///
    /// `session` 替换 API 客户端使用的 URL 会话; 测试会传入桩会话. `toasts` 显示会话相关提示以及同步会话
    /// 的提示, 测试因此可以通过替身断言它们.
    init(modelContext: ModelContext, session: URLSession? = nil,
         downloads: (any DownloadScopeControlling)? = nil, identityStore: LastIdentityStore = LastIdentityStore(),
         toasts: any ToastPresenting = ToastManager.shared) {
        self.modelContext = modelContext
        self.serverURL = Server.current(in: modelContext)?.url ?? ""
        self.session = session
        self.downloads = downloads
        self.identityStore = identityStore
        self.toasts = toasts
        // Removed with this view model, so a released one never reacts to another session's 401.
        //
        // 随视图模型一起移除, 已释放的视图模型不会再响应其他会话的 401.
        authObserver = NotificationObservation(.authExpired) { [weak self] notification in
            let token = notification.userInfo?[Notification.rejectedTokenKey] as? String
            Task { @MainActor in
                self?.handleAuthExpired(rejectedToken: token)
            }
        }
    }

    /// The configured server's URL, empty when none is. Cached from the stored `Server` and updated
    /// wherever this view model replaces or deletes it, so views can read it in `body` without a fetch.
    ///
    /// 已配置服务器的地址, 未配置时为空. 从已保存的 `Server` 缓存而来, 本视图模型替换或删除服务器时
    /// 同步更新, 因此视图在 `body` 中读取它不会触发查询.
    private(set) var serverURL: String

    /// Applies `event` to the state machine and publishes the new state when it changed. Returns
    /// whether the event applied.
    ///
    /// 将 `event` 应用到状态机, 状态变化时发布新状态. 返回事件是否生效.
    @discardableResult
    private func send(_ event: AppEvent) -> Bool {
        guard machine.send(event) else { return false }
        if state != machine.state { state = machine.state }
        return true
    }

    /// Starts a new session epoch and returns it; see `AppSessionMachine`.
    ///
    /// 开始新的会话纪元并返回它; 参见 `AppSessionMachine`.
    private func beginSession() -> Int {
        send(.beginSession)
        return machine.epoch
    }

    func bootstrap() async {
        let epoch = beginSession()
        let server = Server.current(in: modelContext)
        serverURL = server?.url ?? ""
        guard let server else {
            // Leaving offline mode opened from setup: close its store and scope too.
            //
            // 离开从设置页打开的离线模式: 同时关闭其存储与作用域.
            sync?.stop()
            sync = nil
            await releaseDownloads()
            send(.needsSetup(epoch: epoch))
            return
        }

        let store = AuthStore(serverURL: server.url)
        authStore = store
        // An expired credential still means the user was signed in: once the server answers, say the
        // session expired instead of reporting what an anonymous request got.
        //
        // 过期凭据仍说明用户曾经登录: 服务器有应答后提示登录已过期, 而不是报告匿名请求得到的结果.
        let saved = store.read()
        let savedToken = saved.credential?.accessToken
        accessTokenBox.set(savedToken)
        let client = makeClient(for: server.url)
        apiClient = client
        serverVersion = ""
        client.configureKingfisher()

        let user: User
        do {
            // Use a short bootstrap timeout so stale servers return to setup quickly.
            //
            // 使用较短启动超时, 避免失效服务器长时间阻塞并快速回到设置页.
            user = try await withTimeout(bootstrapTimeout) { try await client.me() }
        } catch is CancellationError {
            // Parent task cancelled, usually because the view disappeared.
            //
            // 父任务被取消, 通常是视图已经消失, 这里不再更新 UI 状态.
            return
        } catch {
            guard machine.isCurrent(epoch) else { return }
            await failBootstrap(error, serverURL: server.url, savedToken: savedToken,
                                savedTokenExpired: saved == .expired, epoch: epoch)
            return
        }

        guard machine.isCurrent(epoch) else { return }
        if saved == .expired {
            resetToServerSetup(message: Self.sessionExpiredMessage)
            return
        }
        await completeSignIn(user, epoch: epoch)
    }

    /// Ends a bootstrap whose `me()` failed: offline when the server is unreachable and downloads
    /// exist, otherwise the setup screen with the reason.
    ///
    /// 结束 `me()` 失败的启动: 服务器不可达且有下载时进入离线, 否则回到设置页并说明原因.
    private func failBootstrap(_ error: Error, serverURL: String, savedToken: String?, savedTokenExpired: Bool,
                               epoch: Int) async {
        #if os(iOS)
        if enterOfflineIfPossible(serverURL: serverURL, error: error, epoch: epoch) { return }
        #endif
        if savedTokenExpired, !BootstrapFailure.isUnreachable(error) {
            resetToServerSetup(message: Self.sessionExpiredMessage)
            return
        }
        await releaseDownloads()
        guard send(.needsSetup(epoch: epoch)) else { return }
        prefillServerURL = serverURL
        if let urlError = error as? URLError, urlError.code == .timedOut {
            toasts.show(String(localized: "Connection timed out"))
        } else if let apiError = error as? APIError, apiError.isUnauthorized, savedToken != nil {
            // The saved token was rejected (for example the server's database was reset);
            // `.authExpired` resets to setup and says the session expired.
            //
            // 保存的 token 被拒绝 (例如服务端数据库被重置); `.authExpired` 会回到设置页并提示登录过期.
        } else {
            // Anything else shows its message; without a token, a 401 means the server turned
            // anonymous access off.
            //
            // 其他错误显示其提示; 没有 token 时, 401 表示服务端关闭了匿名访问.
            toasts.show(error: error)
        }
    }

    /// The post-authentication sequence shared by bootstrap and connect: open the user's store, move
    /// to the signed-in screens, check the server version, then start sync and downloads. Stops at
    /// any step where the session epoch changed.
    ///
    /// 启动与连接共用的认证后流程: 打开用户的存储, 进入已登录页面, 检查服务端版本, 然后启动同步与
    /// 下载. 任何一步发现会话纪元已变化都会停止.
    private func completeSignIn(_ user: User, epoch: Int) async {
        currentUser = user
        // Open the store before the screens appear, so they never render without it.
        //
        // 在页面出现之前打开存储, 页面因此不会在没有存储的情况下渲染.
        openSync(for: user)
        await releaseDownloads(keeping: downloadScopeKey(for: user))
        guard send(.signedIn(epoch: epoch)) else { return }
        // Check server compatibility after authentication because settings are fetched best-effort.
        //
        // 认证成功后再检查服务端兼容性, 因为设置接口是尽力获取.
        await startSyncIfCompatible(epoch: epoch)
        guard machine.isCurrent(epoch) else { return }
        if state == .authenticated {
            await activateDownloads(for: user)
        } else {
            await releaseDownloads()
        }
    }

    #if os(iOS)
    /// Opens the device's downloads when the server is unreachable and any completed download
    /// exists. Returns whether the app went offline.
    ///
    /// 服务器无法连接且本机存在已完成的下载时, 打开本机下载. 返回 App 是否进入离线状态.
    private func enterOfflineIfPossible(serverURL: String, error: Error, epoch: Int) -> Bool {
        guard BootstrapFailure.isUnreachable(error), hasOfflineDownloads else { return false }
        enterOffline(offlineIdentity(serverURL: serverURL), epoch: epoch)
        return true
    }

    /// Whether the device has a completed download to watch offline, whatever server or account it
    /// was made under and whether anyone is signed in.
    ///
    /// 本机是否有可离线观看的已完成下载, 无论它属于哪个服务器或账号, 也无论是否有人登录.
    var hasOfflineDownloads: Bool { downloads?.hasCompletedDownloads ?? false }

    /// The identity whose local store records progress offline: the configured server's most recent
    /// one, or none, so progress never lands in an account of another server or one that signed out.
    ///
    /// 离线时用于记录进度的本地存储所属身份: 当前配置服务器上最近使用的身份, 没有则为空, 因此进度不会
    /// 记入其他服务器的账号或已登出的账号.
    func offlineIdentity(serverURL: String) -> DownloadIdentity? {
        identityStore.known().first { $0.matches(serverURL: serverURL) }
    }

    /// Opens the device's downloads offline now, without waiting for the server; a bootstrap or
    /// connect still in flight drops its result.
    ///
    /// 不等服务器响应, 立即离线打开本机下载; 仍在进行的启动或连接请求会丢弃其结果.
    func openDownloadsOffline() {
        guard hasOfflineDownloads else { return }
        let epoch = beginSession()
        enterOffline(offlineIdentity(serverURL: serverURL), epoch: epoch)
    }

    /// Opens `identity`'s downloads and store offline for the session at `epoch`.
    ///
    /// 为纪元为 `epoch` 的会话离线打开 `identity` 的下载与存储.
    private func enterOffline(_ identity: DownloadIdentity?, epoch: Int) {
        guard let downloads, machine.isCurrent(epoch) else { return }
        if let identity {
            let user = User(id: Int(identity.userID), username: identity.username, role: "user")
            // The engine stays idle offline; it is there so a reconnect as the same user keeps this store.
            // A never-started engine parks sync requests until its first start, so stop it: requests
            // made offline (a foreground return, a page) then return at once.
            //
            // 离线时引擎保持空闲; 保留它是为了以同一用户重新连接时继续使用这个存储. 从未启动的引擎会
            // 让同步请求一直等到首次启动, 因此将其停止: 离线时发出的请求 (回到前台, 进入页面) 会立即返回.
            openSync(for: user, serverURL: identity.serverURL, api: makeClient(for: identity.serverURL))
            sync?.stop()
            downloads.openOffline(scopeKey: identity.scopeKey)
        } else {
            sync?.stop()
            sync = nil
            downloads.beginDeactivate()
        }
        send(.wentOffline(identity, epoch: epoch))
    }

    /// Retries the connection from offline mode.
    ///
    /// 在离线模式下重新尝试连接.
    func reconnect() async {
        send(.reconnect)
        await bootstrap()
    }
    #endif

    /// Signs in to `url`, with an account or anonymously. The request runs first, against a client
    /// of its own; only when it succeeds are the stored server, token, sync, and downloads replaced,
    /// so a failed connect keeps the previous server. It fails with `URLError(.timedOut)` after
    /// `connectTimeout`, and with `CancellationError` when its task is cancelled or the user left
    /// for offline mode meanwhile.
    ///
    /// 以账号或匿名方式登录 `url`. 请求先通过独立的客户端发出; 只有成功后才替换已保存的服务器,
    /// token, 同步与下载, 因此连接失败时保留之前的服务器. 超过 `connectTimeout` 后以
    /// `URLError(.timedOut)` 失败; 任务被取消或用户在此期间进入离线模式时以 `CancellationError` 失败.
    func connectServer(url: String, username: String, password: String) async throws {
        let epoch = beginSession()
        let serverURL = Server(url: url).url
        let probe = APIClient(baseURL: serverURL, session: session)

        let user: User
        let login: LoginResponse?
        if !username.isEmpty && !password.isEmpty {
            let response = try await withTimeout(connectTimeout) {
                try await probe.login(username: username, password: password)
            }
            user = response.user
            login = response
        } else {
            user = try await withTimeout(connectTimeout) { try await probe.me() }
            login = nil
        }

        guard machine.isCurrent(epoch), !Task.isCancelled else {
            // The user left meanwhile: replace nothing, and revoke the token nobody will use.
            //
            // 用户已在此期间离开: 不替换任何内容, 并注销不会再被使用的 token.
            if let login { revoke(login.accessToken, serverURL: serverURL) }
            throw CancellationError()
        }

        let store = AuthStore(serverURL: serverURL)
        if let login {
            do {
                try store.save(accessToken: login.accessToken, expiresAt: login.expiresAt)
            } catch {
                revoke(login.accessToken, serverURL: serverURL)
                throw error
            }
        } else {
            store.clear()
        }
        if let previous = authStore, previous != store { previous.clear() }

        // Single-server mode: the new server replaces any previous one.
        //
        // 单服务器模式: 新服务器替换之前的服务器.
        Server.deleteAll(in: modelContext)
        modelContext.insert(Server(url: serverURL))
        try? modelContext.save()
        self.serverURL = serverURL
        authStore = store
        accessTokenBox.set(login?.accessToken)
        let client = makeClient(for: serverURL)
        apiClient = client
        serverVersion = ""
        client.configureKingfisher()

        // Committed: the setup screen going away must not cut the sign-in short, so it runs in its
        // own task; the session epoch still stops it if the user leaves.
        //
        // 已提交: 设置页消失不能中断登录流程, 因此它在独立任务中运行; 用户离开时仍由会话纪元终止它.
        await Task { await self.completeSignIn(user, epoch: epoch) }.value
    }

    /// Best-effort server logout of a token the app will not keep.
    ///
    /// 尽力在服务端注销应用不会保留的 token.
    private func revoke(_ token: String, serverURL: String) {
        let client = APIClient(baseURL: serverURL, session: session, tokenProvider: { token },
                               notifiesAuthExpired: false)
        Task { _ = try? await client.logout(timeoutInterval: 3) }
    }

    func logout() async {
        // A bootstrap or connect still in flight must not sign back in.
        //
        // 仍在进行的启动或连接不能重新登录.
        _ = beginSession()
        // Stop syncing first: a cycle running while the token is revoked would report the session
        // as expired.
        //
        // 先停止同步: 在 token 被注销期间运行的同步会把会话误报为过期.
        sync?.stop()
        // Best-effort server logout with 3s timeout - don't block on failed server
        //
        // 登出请求尽力发送, 服务器不可用时不阻塞本地退出.
        if let client = apiClient {
            _ = try? await client.logout(timeoutInterval: 3)
        }
        identityStore.clear()
        // The setup screen shows at once; downloads deactivate behind it, after any running activation.
        //
        // 设置页立即显示; 下载在其后停用, 排在正在执行的激活之后.
        resetToServerSetup()
    }

    /// Pre-filled server URL after logout.
    ///
    /// 登出或连接失败后预填的服务器地址.
    var prefillServerURL: String = ""

    /// Opens the sync scope of `user`, replacing any previous one. Screens can read the store at
    /// once; the engine stays idle until `startSyncIfCompatible()`. When the current session already
    /// holds that scope for the same username, it is kept, so the scope never has two stores.
    ///
    /// 打开 `user` 的同步作用域, 并替换之前的作用域. 页面可以立即读取存储; 引擎在
    /// `startSyncIfCompatible()` 之前保持空闲. 当前会话已持有同一用户名的该作用域时会继续使用它,
    /// 因此一个作用域不会出现两个存储.
    private func openSync(for user: User, serverURL: String? = nil, api: (any SyncAPIProtocol)? = nil) {
        let serverURL = serverURL ?? self.serverURL
        let userID = Int64(max(0, user.id))
        let scopeKey = syncScopeKey(serverURL: serverURL, userID: userID)
        sync?.stop()
        if let sync, sync.store.scopeKey == scopeKey,
           sync.store.username == (userID > 0 ? user.username : ""),
           sync.engine != nil || userID == 0 {
            return
        }
        sync = SyncSession(context: modelContext, serverURL: serverURL, user: user, api: api ?? apiClient,
                           activeUserID: { [weak self] in self?.currentUser.map { Int64(max(0, $0.id)) } },
                           onScopeDropped: { [weak self] in Task { await self?.downloads?.deleteScope(scopeKey) } },
                           toasts: toasts)
    }

    /// The download scope of `user`; nil for the anonymous user, who has no downloads.
    ///
    /// `user` 的下载作用域; 匿名用户没有下载, 返回 nil.
    private func downloadScopeKey(for user: User) -> String? {
        user.id > 0 ? syncScopeKey(serverURL: serverURL, userID: Int64(user.id)) : nil
    }

    /// Deactivates downloads unless the active scope is `scopeKey`. Runs on every transition that
    /// leaves offline or signed-in state, so a previous identity's downloads (for example those
    /// opened offline) never show under another account or on the setup screen.
    ///
    /// 除非当前作用域就是 `scopeKey`, 否则停用下载. 每次离开离线或已登录状态时都会执行, 因此之前身份的
    /// 下载 (例如离线打开的下载) 不会显示在其他账号下或设置页中.
    private func releaseDownloads(keeping scopeKey: String? = nil) async {
        guard let downloads, let active = downloads.activeScopeKey, active != scopeKey else { return }
        await downloads.deactivate()
    }

    /// Records the identity and activates its download scope; the anonymous user has no downloads.
    ///
    /// 记录身份并激活其下载作用域; 匿名用户没有下载.
    private func activateDownloads(for user: User) async {
        guard user.id > 0 else {
            await downloads?.deactivate()
            return
        }
        let userID = Int64(user.id)
        identityStore.save(DownloadIdentity(serverURL: serverURL, userID: userID, username: user.username))
        let client = APIClient(baseURL: serverURL, session: session, tokenProvider: { [accessTokenBox] in
            accessTokenBox.get()
        }, notifiesAuthExpired: false)
        await downloads?.activate(scopeKey: syncScopeKey(serverURL: serverURL, userID: userID),
                                  preparer: DownloadPreparer(api: client))
    }

    /// Checks the server version, then starts the sync engine. A server older than
    /// `VersionCompatibility.minimumServerVersion` has no sync endpoints: the session closes and the
    /// incompatible-server screen shows instead. The check is best-effort, so an unknown version
    /// counts as compatible. A session replaced or closed during the check is left alone.
    ///
    /// 检查服务端版本后启动同步引擎. 低于 `VersionCompatibility.minimumServerVersion` 的服务端没有
    /// 同步接口: 关闭同步会话并显示服务端不兼容页面. 检查是尽力而为的, 版本未知时视为兼容.
    /// 检查期间被替换或关闭的会话不会被处理.
    private func startSyncIfCompatible(epoch: Int) async {
        let captured = sync
        await fetchServerVersion()
        guard machine.isCurrent(epoch), sync === captured else { return }
        if !serverVersion.isEmpty && !VersionCompatibility.isCompatible(serverVersion) {
            guard send(.serverIncompatible(serverVersion: serverVersion,
                                           requiredVersion: VersionCompatibility.minimumServerVersion,
                                           epoch: epoch)) else { return }
            sync?.stop()
            sync = nil
            return
        }
        sync?.start()
    }

    /// Forwards scene phase changes to the sync session.
    ///
    /// 将场景状态变化转发给同步会话.
    func handleScenePhase(_ phase: ScenePhase) {
        sync?.handleScenePhase(phase)
    }

    /// Fetch server version from public settings endpoint (best-effort).
    ///
    /// 从公开设置接口尽力获取服务端版本.
    func fetchServerVersion() async {
        guard let client = apiClient else { return }
        // A reply for a client the app has since replaced belongs to another session.
        //
        // 应用已替换的客户端返回的结果属于其他会话.
        guard let resp = try? await client.getSettings(), apiClient === client else { return }
        serverVersion = resp.settings["version"] ?? ""
    }

    /// Disconnect from current server and return to setup.
    ///
    /// 断开当前服务器连接并返回服务器设置页.
    func disconnectServer() {
        resetToServerSetup()
    }

    /// Handle bearer token expiration: clear local auth and return to setup.
    ///
    /// 处理 bearer token 过期: 清理本地认证状态并返回服务器设置页.
    func handleAuthExpired(rejectedToken: String?) {
        // Only the token in use can expire this session. A 401 for an earlier session's token (an old
        // server, an abandoned bootstrap) is ignored, and so is every 401 after the first one, since
        // the reset clears the token.
        //
        // 只有正在使用的 token 才能让当前会话过期. 之前会话的 token (旧服务器, 被放弃的启动请求) 收到的
        // 401 会被忽略; 首次重置清除 token 后, 后续的 401 也都会被忽略.
        guard let rejectedToken, rejectedToken == accessTokenBox.get() else { return }
        // Posted only for requests that carried a token, so the session expired; the backend's
        // generic "not logged in" code would otherwise read as "anonymous access is disabled".
        // `.sessionExpired` leaves offline mode alone: a late 401 from a bootstrap the user left for
        // offline mode must not end it.
        //
        // 只有携带 token 的请求才会发送该通知, 因此是登录过期; 否则后端通用的 "未登录" 错误码会被显示为
        // "禁止匿名登录". `.sessionExpired` 不会影响离线模式: 用户已改为离线模式后, 被放弃的启动请求
        // 迟到的 401 不能结束离线模式.
        resetToServerSetup(.sessionExpired, message: Self.sessionExpiredMessage)
    }

    private static var sessionExpiredMessage: String {
        String(localized: "Session expired, please sign in again")
    }

    /// Common cleanup: clear stored credentials and redirect to server setup. Ends the session, so
    /// any bootstrap or connect still in flight drops its result. Does nothing when the state machine
    /// rejects `event`.
    ///
    /// 通用清理: 清除已保存凭据并跳转到服务器设置页. 会结束当前会话, 仍在进行的启动或连接会丢弃结果.
    /// 状态机拒绝 `event` 时不做任何事.
    private func resetToServerSetup(_ event: AppEvent = .reset, message: String? = nil) {
        guard send(event) else { return }
        prefillServerURL = serverURL
        authStore?.clear()
        authStore = nil
        accessTokenBox.set(nil)
        apiClient = nil
        currentUser = nil
        serverVersion = ""
        sync?.stop()
        sync = nil
        // Queued now, so an activation that a later sign-in requests runs after it.
        //
        // 立即排入队列, 因此之后登录请求的激活总在它之后执行.
        downloads?.beginDeactivate()
        Server.deleteAll(in: modelContext)
        serverURL = ""
        if let message {
            toasts.show(message)
        }
    }

    /// Creates an API client wired to the current token provider.
    ///
    /// 创建绑定当前 token provider 的 API 客户端.
    private func makeClient(for serverURL: String) -> APIClient {
        APIClient(baseURL: serverURL, session: session, tokenProvider: { [accessTokenBox] in
            accessTokenBox.get()
        })
    }
}
