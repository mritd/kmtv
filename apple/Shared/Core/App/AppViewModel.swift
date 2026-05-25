import Foundation
import SwiftData

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

    private var modelContext: ModelContext

    private let accessTokenBox = AccessTokenBox()
    private var authStore: AuthStore?
    private var authObserver: Any?

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
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
            state = .authenticated
            // Check server compatibility after authentication because settings are fetched best-effort.
            // 认证成功后再检查服务端兼容性, 因为设置接口是尽力获取.
            await fetchServerVersion()
            if !serverVersion.isEmpty && !VersionCompatibility.isCompatible(serverVersion) {
                state = .incompatibleServer(
                    serverVersion: serverVersion,
                    requiredVersion: VersionCompatibility.minimumServerVersion
                )
                return
            }
        } catch let error as URLError where error.code == .timedOut {
            prefillServerURL = server.url
            state = .serverSetup
            ToastManager.shared.show(String(localized: "Connection timed out"))
        } catch let error as APIError {
            prefillServerURL = server.url
            state = .serverSetup
            if case .unauthorized = error {
                // 401: just go to setup, no toast needed
                // 401 表示本地 token 失效, 直接回到设置页, 不额外弹 toast.
            } else {
                ToastManager.shared.show(error.localizedMessage)
            }
        } catch is CancellationError {
            // Parent task cancelled, usually because the view disappeared.
            // 父任务被取消, 通常是视图已经消失, 这里不再更新 UI 状态.
        } catch {
            prefillServerURL = server.url
            state = .serverSetup
            ToastManager.shared.show(error.localizedDescription)
        }
    }

    func connectServer(url: String, username: String, password: String) async throws {
        // Remove any existing server (single-server mode)
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
            state = .authenticated
        } catch {
            // Rollback
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
        state = .authenticated
    }

    func logout() async {
        // Best-effort server logout with 3s timeout - don't block on failed server
        // 登出请求尽力发送, 服务器不可用时不阻塞本地退出.
        if let client = apiClient {
            _ = try? await client.logout(timeoutInterval: 3)
        }
        resetToServerSetup()
    }

    /// Pre-filled server URL after logout.
    /// 登出或连接失败后预填的服务器地址.
    var prefillServerURL: String = ""

    /// Fetch server version from public settings endpoint (best-effort).
    /// 从公开设置接口尽力获取服务端版本.
    func fetchServerVersion() async {
        guard let client = apiClient else { return }
        if let resp = try? await client.getSettings() {
            serverVersion = resp.settings["version"] ?? ""
        }
    }

    /// Disconnect from current server and return to setup.
    /// 断开当前服务器连接并返回服务器设置页.
    func disconnectServer() {
        resetToServerSetup()
    }

    /// Handle bearer token expiration: clear local auth and return to setup.
    /// 处理 bearer token 过期: 清理本地认证状态并返回服务器设置页.
    func handleAuthExpired(_ error: APIError) {
        resetToServerSetup(toast: error)
    }

    /// Common cleanup: clear stored credentials and redirect to server setup.
    /// 通用清理: 清除已保存凭据并跳转到服务器设置页.
    private func resetToServerSetup(toast error: APIError? = nil) {
        prefillServerURL = serverURL
        authStore?.clear()
        authStore = nil
        accessTokenBox.set(nil)
        apiClient = nil
        currentUser = nil
        serverVersion = ""
        Server.deleteAll(in: modelContext)
        state = .serverSetup
        if let error {
            ToastManager.shared.show(error.localizedMessage)
        }
    }

    /// Creates an API client wired to the current token provider.
    /// 创建绑定当前 token provider 的 API 客户端.
    private func makeClient(for serverURL: String) -> APIClient {
        APIClient(baseURL: serverURL, tokenProvider: { [accessTokenBox] in
            accessTokenBox.get()
        })
    }
}
