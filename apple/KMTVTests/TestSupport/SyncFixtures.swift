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
