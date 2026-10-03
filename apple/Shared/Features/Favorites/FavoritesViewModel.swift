import Foundation

/// Favorites screen state backed by the sync store.
///
/// 基于同步存储的收藏页状态.
@Observable
@MainActor
final class FavoritesViewModel {
    private let syncStore: SyncStore?
    private let syncEngine: SyncEngine?

    /// Favorites, newest first.
    ///
    /// 收藏列表, 最新的在前.
    var favorites: [FavoritePayload] { syncStore?.favoriteItems ?? [] }

    init(syncStore: SyncStore?, syncEngine: SyncEngine?) {
        self.syncStore = syncStore
        self.syncEngine = syncEngine
    }

    /// Requests a throttled page sync when the screen appears.
    ///
    /// 页面出现时请求一次限频的页面同步.
    func load() {
        guard let syncEngine else { return }
        Task { await syncEngine.requestSync(.page) }
    }

    /// Removes a favorite on every device.
    ///
    /// 在所有设备上删除一个收藏.
    func remove(_ item: FavoritePayload) {
        syncStore?.remove(.favorite, key: item.title)
    }
}
