import SwiftData
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// The sync store of the signed-in identity, plus an engine when the user is not anonymous.
///
/// 当前登录身份的同步存储; 非匿名用户还会有一个同步引擎.
@MainActor
final class SyncSession {
    let store: SyncStore
    let engine: SyncEngine?
    private var wasInBackground = false

    /// Opens the scope of `user` on `serverURL`. Anonymous user 0 keeps data local only. The engine
    /// stays idle until `start()`, so the app can open the store before it checks the server version.
    ///
    /// 打开 `user` 在 `serverURL` 上的作用域. 匿名用户 0 的数据只保存在本地. 引擎在 `start()` 之前
    /// 保持空闲, 应用因此可以先打开存储, 再检查服务端版本.
    ///
    /// `activeUserID` reports the user the app is signed in as right now. When it differs from
    /// `user`, the session's requests fail as unauthorized instead of reaching the server with
    /// another account's token.
    ///
    /// `activeUserID` 返回应用当前登录的用户. 它与 `user` 不同时, 会话的请求会以未授权失败, 而不会
    /// 带着另一个账号的 token 发往服务端.
    init(context: ModelContext, serverURL: String, user: User, api: (any SyncAPIProtocol)?,
         activeUserID: (@MainActor @Sendable () -> Int64?)? = nil) {
        let userID = Int64(max(0, user.id))
        store = SyncStore(context: context, serverURL: serverURL, userID: userID,
                          username: userID > 0 ? user.username : "")
        if userID > 0, let api {
            let bound = UserBoundSyncAPI(base: api, userID: userID, activeUserID: activeUserID)
            let engine = SyncEngine(api: bound, store: store)
            engine.onLimit = { _ in ToastManager.shared.show(String(localized: "Favorites are full")) }
            self.engine = engine
        } else {
            engine = nil
        }
    }

    /// Starts the engine and runs the launch sync.
    ///
    /// 启动引擎并执行启动同步.
    func start() {
        guard let engine else { return }
        engine.start()
        Task { await engine.requestSync(.launch) }
    }

    /// Stops the engine.
    ///
    /// 停止引擎.
    func stop() {
        engine?.stop()
    }

    /// Syncs when the app returns from the background and flushes pending changes when it goes there.
    /// `.inactive` to `.active` (Control Center, the app switcher) is not a return and syncs nothing.
    ///
    /// 应用从后台返回时同步, 进入后台时补写待同步的修改. `.inactive` 到 `.active` (控制中心,
    /// 应用切换器) 不算返回, 不会触发同步.
    func handleScenePhase(_ phase: ScenePhase) {
        guard let engine else { return }
        switch phase {
        case .active:
            guard wasInBackground else { return }
            wasInBackground = false
            Task { await engine.requestSync(.foreground) }
        case .background:
            wasInBackground = true
            flushInBackground(engine)
        default: break
        }
    }

    // The system suspends a backgrounded app within seconds; a background task keeps it running
    // until the flush finishes or the system's time runs out.
    //
    // 进入后台的应用几秒内就会被系统挂起; 后台任务让应用持续运行, 直到补写完成或系统给的时间用完.
    private func flushInBackground(_ engine: SyncEngine) {
        #if canImport(UIKit)
        let backgroundTask = SyncBackgroundTask()
        backgroundTask.begin()
        Task {
            await engine.flushNow()
            backgroundTask.end()
        }
        #else
        Task { await engine.flushNow() }
        #endif
    }
}

/// Forwards sync requests only while the app is signed in as the session's user.
///
/// 仅当应用以会话所属用户登录时才转发同步请求.
private struct UserBoundSyncAPI: SyncAPIProtocol {
    let base: any SyncAPIProtocol
    let userID: Int64
    let activeUserID: (@MainActor @Sendable () -> Int64?)?

    func syncPush(_ request: SyncPushRequest) async throws -> SyncPushResponse {
        try await check()
        return try await base.syncPush(request)
    }

    func syncPull(since: Int64, epoch: String, limit: Int) async throws -> SyncPullResponse {
        try await check()
        return try await base.syncPull(since: since, epoch: epoch, limit: limit)
    }

    // `SyncErrorKind.classify` maps `APIError.unauthorized` to the unauthorized kind, so the engine
    // stops instead of retrying.
    //
    // `SyncErrorKind.classify` 将 `APIError.unauthorized` 映射为未授权, 引擎因此停止而不是重试.
    private func check() async throws {
        guard let activeUserID else { return }
        let active = await activeUserID()
        guard active == userID else { throw APIError.unauthorized }
    }
}

#if canImport(UIKit)
/// One UIKit background task; ending it more than once does nothing.
///
/// 一个 UIKit 后台任务; 多次结束不会产生影响.
@MainActor
private final class SyncBackgroundTask {
    private var id = UIBackgroundTaskIdentifier.invalid

    func begin() {
        id = UIApplication.shared.beginBackgroundTask(withName: "kmtv.sync.flush") { [weak self] in
            MainActor.assumeIsolated { self?.end() }
        }
    }

    func end() {
        guard id != .invalid else { return }
        UIApplication.shared.endBackgroundTask(id)
        id = .invalid
    }
}
#endif
