import Foundation
import SwiftData

/// Builds the app's SwiftData container from one schema shared by iOS, tvOS, and tests.
///
/// 使用 iOS, tvOS 与测试共用的同一个 schema 创建应用的 SwiftData 容器.
enum AppModelContainer {
    /// Every persisted model. The legacy history models stay until the sync rollout removes them.
    ///
    /// 所有持久化模型. 旧的历史模型会保留到同步改造移除它们为止.
    static let schema = Schema([
        Server.self, PlaybackSettings.self, SyncRecord.self, SyncScopeState.self,
        WatchHistoryItem.self, FavoriteItem.self, SearchHistoryItem.self,
    ])

    /// Opens the on-disk container.
    ///
    /// 打开磁盘上的容器.
    static func make() throws -> ModelContainer {
        try ModelContainer(for: schema)
    }

    /// Opens an in-memory container for tests and previews.
    ///
    /// 为测试与预览打开内存容器.
    static func makeInMemory() throws -> ModelContainer {
        try ModelContainer(for: schema, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
    }
}
