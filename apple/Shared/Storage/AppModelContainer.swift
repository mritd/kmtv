import Foundation
import SwiftData

/// Builds the app's SwiftData container from one schema shared by iOS, tvOS, and tests.
///
/// 使用 iOS, tvOS 与测试共用的同一个 schema 创建应用的 SwiftData 容器.
enum AppModelContainer {
    /// Store file name. The sync rollout dropped models SwiftData cannot migrate away, so the store moved.
    ///
    /// 存储文件名. 同步改造删除了 SwiftData 无法迁移掉的模型, 因此存储文件改名.
    static let storeName = "KMTV-sync-v1"

    /// Every persisted model.
    ///
    /// 所有持久化模型.
    static let schema = Schema([Server.self, PlaybackSettings.self, SyncRecord.self, SyncScopeState.self])

    /// Deletes the old store, then opens the on-disk container.
    ///
    /// 删除旧存储后打开磁盘上的容器.
    static func make() throws -> ModelContainer {
        removeLegacyStore()
        return try ModelContainer(for: schema, configurations: ModelConfiguration(storeName, schema: schema))
    }

    /// Opens an in-memory container for tests and previews.
    ///
    /// 为测试与预览打开内存容器.
    static func makeInMemory() throws -> ModelContainer {
        try ModelContainer(for: schema, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
    }

    /// Removes the pre-sync `default.store` files. No data is migrated. The default directory is where
    /// SwiftData puts a default store on this platform, which is not Application Support on every OS.
    ///
    /// 删除同步改造前的 `default.store` 文件. 不迁移任何数据. 默认目录是 SwiftData 在当前平台存放
    /// 默认存储的位置, 并非每个系统都是 Application Support.
    static func removeLegacyStore(in directory: URL = ModelConfiguration().url.deletingLastPathComponent(),
                                  fileManager: FileManager = .default) {
        for name in ["default.store", "default.store-shm", "default.store-wal"] {
            try? fileManager.removeItem(at: directory.appending(path: name))
        }
    }
}
