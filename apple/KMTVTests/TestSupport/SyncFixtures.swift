import Foundation
import SwiftData
@testable import KMTV

// A ModelContext does not keep its container alive, so stores made here keep a reference to it
// for the rest of the test run.
//
// ModelContext 不会保持其容器存活, 因此这里创建的存储会在整个测试运行期间保留容器的引用.
@MainActor private var retainedContainers: [ModelContainer] = []

/// Opens a sync store on an in-memory container with a fixed clock.
///
/// 在内存容器上打开一个使用固定时钟的同步存储.
@MainActor
func makeSyncStore(_ container: ModelContainer, serverURL: String = "https://kmtv.example",
                   userID: Int64 = 1, username: String = "admin") -> SyncStore {
    retainedContainers.append(container)
    return SyncStore(context: container.mainContext, serverURL: serverURL, userID: userID, username: username,
                     clock: SyncClock(offsetMs: 0, now: { 1_000 }))
}

/// Opens a sync store whose clock moves 1 ms per read, so writes get distinct, increasing times.
///
/// 打开一个每次读取时钟前进 1 毫秒的同步存储, 让每次写入获得不同且递增的时间.
@MainActor
func makeTickingSyncStore(_ container: ModelContainer) -> SyncStore {
    retainedContainers.append(container)
    let wall = ManualClock()
    return SyncStore(context: container.mainContext, serverURL: "https://kmtv.example", userID: 1, username: "admin",
                     clock: SyncClock(offsetMs: 0, now: { wall.nowMs += 1; return wall.nowMs }))
}

/// Polls `condition` until it holds or `timeout` passes; for work that hops off the main actor.
///
/// 轮询 `condition` 直到成立或超时; 用于会离开主 actor 执行的异步工作.
@MainActor
func waitUntil(timeout: Duration = .seconds(2), _ condition: () -> Bool) async {
    let deadline = ContinuousClock.now + timeout
    while !condition() && ContinuousClock.now < deadline {
        try? await Task.sleep(for: .milliseconds(5))
    }
}

/// Scripted sync API: pull pages are served in order, pushes are acknowledged unless overridden.
///
/// 脚本化的同步 API: 按顺序返回拉取页, 推送默认全部确认, 可被覆盖.
@MainActor
final class FakeSyncAPI: SyncAPIProtocol {
    var pulls: [Result<SyncPullResponse, Error>] = []
    var pushes: [SyncPushRequest] = []
    var pullCount = 0
    /// The `since` cursor of every pull, in order.
    ///
    /// 每次拉取的 `since` 游标, 按调用顺序排列.
    var pullSinces: [Int64] = []
    /// The `full` flag of every pull, in order.
    ///
    /// 每次拉取的 `full` 标志, 按调用顺序排列.
    var pullFulls: [Bool] = []
    var pushHandler: ((SyncPushRequest) throws -> SyncPushResponse)?
    var hangPull = false
    /// Awaited before a push or pull answers, so a test can hold a request in flight.
    ///
    /// 推送或拉取返回前会等待它, 测试可借此让请求停在进行中.
    var pushGate: SyncTestGate?
    var pullGate: SyncTestGate?

    func syncPush(_ request: SyncPushRequest) async throws -> SyncPushResponse {
        pushes.append(request)
        await pushGate?.wait()
        if let pushHandler { return try pushHandler(request) }
        return SyncPushResponse(epoch: request.epoch.isEmpty ? "e1" : request.epoch, rev: Int64(request.changes.count),
                                serverTimeMs: 1, results: request.changes.indices.map { SyncResultWire(index: $0, status: .applied) })
    }

    func syncPull(since: Int64, epoch: String, limit: Int, full: Bool) async throws -> SyncPullResponse {
        pullCount += 1
        pullSinces.append(since)
        pullFulls.append(full)
        await pullGate?.wait()
        if hangPull { try await Task.sleep(for: .seconds(3600)) }
        guard !pulls.isEmpty else { return SyncPullResponse(epoch: epoch.isEmpty ? "e1" : epoch, rev: since) }
        return try pulls.removeFirst().get()
    }
}

/// Manual scheduler: records requested delays and fires actions on demand.
///
/// 手动调度器: 记录请求的延迟, 并按需触发动作.
@MainActor
final class FakeSyncScheduler {
    private(set) var pending: [(delayMs: Int64, action: @MainActor @Sendable () -> Void, cancelled: Bool)] = []

    var scheduler: SyncScheduler {
        { delayMs, action in
            let index = self.pending.count
            self.pending.append((delayMs, action, false))
            return SyncTimerHandle { [weak self] in self?.pending[index].cancelled = true }
        }
    }

    /// Delays of timers that are still armed.
    ///
    /// 仍处于待触发状态的定时器延迟.
    var armedDelays: [Int64] { pending.filter { !$0.cancelled }.map(\.delayMs) }

    /// Fires the oldest armed timer.
    ///
    /// 触发最早的待触发定时器.
    func fireNext() {
        guard let index = pending.firstIndex(where: { !$0.cancelled }) else { return }
        pending[index].cancelled = true
        pending[index].action()
    }
}

/// Holds callers until `open()`; callers arriving after that pass straight through.
///
/// 在 `open()` 之前挂起调用方; 之后到达的调用方直接通过.
@MainActor
final class SyncTestGate {
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private var opened = false

    /// Number of callers currently held.
    ///
    /// 当前被挂起的调用方数量.
    var waiting: Int { waiters.count }

    func wait() async {
        guard !opened else { return }
        await withCheckedContinuation { waiters.append($0) }
    }

    func open() {
        opened = true
        let held = waiters
        waiters = []
        for waiter in held { waiter.resume() }
    }
}
