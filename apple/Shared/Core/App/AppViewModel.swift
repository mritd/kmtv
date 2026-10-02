import Foundation
import SwiftData
import SwiftUI

enum AppState {
    case loading
    case serverSetup
    case authenticated
    case incompatibleServer(serverVersion: String, requiredVersion: String)
}

@Observable
@MainActor
final class AppViewModel {
    var state: AppState = .loading
    var currentUser: User?
    var apiClient: APIClient?
    var serverVersion: String = ""

    /// Sync store and engine of the current identity; nil until authenticated.
    ///
    /// 当前身份的同步存储与引擎; 认证前为 nil.
    private(set) var sync: SyncSession?

    private var modelContext: ModelContext
    private let session: URLSession?

    private let accessTokenBox = AccessTokenBox()
    private var authStore: AuthStore?
    private var authObserver: Any?

    /// `session` replaces the API client's URL session; tests pass a stubbed one.
    ///
    /// `session` 替换 API 客户端使用的 URL 会话; 测试会传入桩会话.
    init(modelContext: ModelContext, session: URLSession? = nil) {
        self.modelContext = modelContext
        self.session = session
        authObserver = NotificationCenter.default.addObserver(
            forName: .authExpired, object: nil, queue: .main
        ) { [weak self] notification in
            guard let self, let error = notification.object as? APIError else { return }
            Task { @MainActor in
                self.handleAuthExpired(error)
            }
        }
    }

    var serverURL: String {
        Server.current(in: modelContext)?.url ?? ""
    }

    func bootstrap() async {
        guard let server = Server.current(in: modelContext) else {
            state = .serverSetup
            return
        }

        let store = AuthStore(serverURL: server.url)
        authStore = store
        accessTokenBox.set(store.load()?.accessToken)
        let client = makeClient(for: server.url)
        apiClient = client
        client.configureKingfisher()

        do {
            // Use a short bootstrap timeout so stale servers return to setup quickly.
            //
            // 使用较短启动超时, 避免失效服务器长时间阻塞并快速回到设置页.
            let innerTask = Task {
                try await client.me()
            }
            let timeoutTask = Task {
                try await Task.sleep(for: .seconds(5))
                innerTask.cancel()
            }
            let user: User
            do {
                user = try await innerTask.value
                timeoutTask.cancel()
            } catch is CancellationError {
                timeoutTask.cancel()
                try Task.checkCancellation()
                throw URLError(.timedOut)
            }

            currentUser = user
            // Open the store before the screens appear, so they never render without it.
            //
            // 在页面出现之前打开存储, 页面因此不会在没有存储的情况下渲染.
            openSync(for: user)
            state = .authenticated
            // Check server compatibility after authentication because settings are fetched best-effort.
            //
            // 认证成功后再检查服务端兼容性, 因为设置接口是尽力获取.
            await startSyncIfCompatible()
        } catch let error as URLError where error.code == .timedOut {
            prefillServerURL = server.url
            state = .serverSetup
            ToastManager.shared.show(String(localized: "Connection timed out"))
        } catch let error as APIError {
            prefillServerURL = server.url
            state = .serverSetup
            if case .unauthorized = error {
                // 401: just go to setup, no toast needed
                //
                // 401 表示本地 token 失效, 直接回到设置页, 不额外弹 toast.
            } else {
                ToastManager.shared.show(error.localizedMessage)
            }
        } catch is CancellationError {
            // Parent task cancelled, usually because the view disappeared.
            //
            // 父任务被取消, 通常是视图已经消失, 这里不再更新 UI 状态.
        } catch {
            prefillServerURL = server.url
            state = .serverSetup
            ToastManager.shared.show(error.localizedDescription)
        }
    }

    func connectServer(url: String, username: String, password: String) async throws {
        // Remove any existing server (single-server mode)
        //
        // 单服务器模式下先移除已有服务器记录.
        Server.deleteAll(in: modelContext)

        let server = Server(url: url)
        modelContext.insert(server)
        try? modelContext.save()

        let store = AuthStore(serverURL: server.url)
        authStore = store
        store.clear()
        accessTokenBox.set(nil)
        let client = makeClient(for: server.url)
        apiClient = client
        client.configureKingfisher()

        do {
            if !username.isEmpty && !password.isEmpty {
                let response = try await client.login(username: username, password: password)
                try store.save(accessToken: response.accessToken, expiresAt: response.expiresAt)
                accessTokenBox.set(response.accessToken)
                currentUser = response.user
            } else {
                currentUser = try await client.me()
            }
            if let currentUser { openSync(for: currentUser) }
            state = .authenticated
            await startSyncIfCompatible()
        } catch {
            // Rollback
            //
            // 连接失败时回滚刚写入的服务器与认证状态.
            modelContext.delete(server)
            try? modelContext.save()
            apiClient = nil
            authStore = nil
            accessTokenBox.set(nil)
            currentUser = nil
            throw error
        }
    }

    func login(username: String, password: String) async throws {
        guard let client = apiClient else { return }
        let response = try await client.login(username: username, password: password)
        if authStore == nil, !serverURL.isEmpty {
            authStore = AuthStore(serverURL: serverURL)
        }
        try authStore?.save(accessToken: response.accessToken, expiresAt: response.expiresAt)
        accessTokenBox.set(response.accessToken)
        currentUser = response.user
        openSync(for: response.user)
        state = .authenticated
        await startSyncIfCompatible()
    }

    func logout() async {
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
        resetToServerSetup()
    }

    /// Pre-filled server URL after logout.
    ///
    /// 登出或连接失败后预填的服务器地址.
    var prefillServerURL: String = ""

    /// Opens the sync scope of `user`, replacing any previous one. Screens can read the store at
    /// once; the engine stays idle until `startSyncIfCompatible()`.
    ///
    /// 打开 `user` 的同步作用域, 并替换之前的作用域. 页面可以立即读取存储; 引擎在
    /// `startSyncIfCompatible()` 之前保持空闲.
    private func openSync(for user: User) {
        sync?.stop()
        sync = SyncSession(context: modelContext, serverURL: serverURL, user: user, api: apiClient,
                           activeUserID: { [weak self] in self?.currentUser.map { Int64(max(0, $0.id)) } })
    }

    /// Checks the server version, then starts the sync engine. A server older than
    /// `VersionCompatibility.minimumServerVersion` has no sync endpoints: the session closes and the
    /// incompatible-server screen shows instead. The check is best-effort, so an unknown version
    /// counts as compatible. A session replaced or closed during the check is left alone.
    ///
    /// 检查服务端版本后启动同步引擎. 低于 `VersionCompatibility.minimumServerVersion` 的服务端没有
    /// 同步接口: 关闭同步会话并显示服务端不兼容页面. 检查是尽力而为的, 版本未知时视为兼容.
    /// 检查期间被替换或关闭的会话不会被处理.
    private func startSyncIfCompatible() async {
        let captured = sync
        await fetchServerVersion()
        guard sync === captured else { return }
        if !serverVersion.isEmpty && !VersionCompatibility.isCompatible(serverVersion) {
            sync?.stop()
            sync = nil
            state = .incompatibleServer(
                serverVersion: serverVersion,
                requiredVersion: VersionCompatibility.minimumServerVersion
            )
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
        if let resp = try? await client.getSettings() {
            serverVersion = resp.settings["version"] ?? ""
        }
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
    func handleAuthExpired(_ error: APIError) {
        resetToServerSetup(toast: error)
    }

    /// Common cleanup: clear stored credentials and redirect to server setup.
    ///
    /// 通用清理: 清除已保存凭据并跳转到服务器设置页.
    private func resetToServerSetup(toast error: APIError? = nil) {
        prefillServerURL = serverURL
        authStore?.clear()
        authStore = nil
        accessTokenBox.set(nil)
        apiClient = nil
        currentUser = nil
        serverVersion = ""
        sync?.stop()
        sync = nil
        Server.deleteAll(in: modelContext)
        state = .serverSetup
        if let error {
            ToastManager.shared.show(error.localizedMessage)
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
