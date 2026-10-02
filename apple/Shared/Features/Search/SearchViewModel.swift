import Foundation
import os

@Observable
@MainActor
final class SearchViewModel {
    var query = ""
    var results: [SearchResult] = []
    var isSearching = false
    var hasSearched = false
    var searchPhase: String = ""
    var searchCompleted: Int = 0
    var searchTotal: Int = 0

    /// Protocol dependency keeps network behavior replaceable in unit tests.
    ///
    /// 使用协议依赖让网络行为可以在单元测试中替换.
    private let apiClient: any SearchAPIProtocol
    private let syncStore: SyncStore?
    private let syncEngine: SyncEngine?
    private let logger = Logger(subsystem: "com.mritd.kmtv", category: "api")

    /// Recent searches shown as chips, newest first.
    ///
    /// 以胶囊显示的最近搜索, 最新的在前.
    var searchHistory: [SearchPayload] {
        Array((syncStore?.searchItems ?? []).prefix(20))
    }

    init(apiClient: any SearchAPIProtocol, syncStore: SyncStore?, syncEngine: SyncEngine?) {
        self.apiClient = apiClient
        self.syncStore = syncStore
        self.syncEngine = syncEngine
    }

    /// Runs a search the user submitted from the search field or a history chip, and records it.
    /// Searches opened from navigation call `search(query:)` and are not recorded.
    ///
    /// 执行用户从搜索框或历史胶囊提交的搜索, 并记录到搜索历史. 从导航打开的搜索调用
    /// `search(query:)`, 不会被记录.
    func submitSearch(query: String? = nil) async {
        if let query { self.query = query }
        let trimmed = self.query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        // Record the query before network work so failed searches are remembered too.
        //
        // 网络请求前先记录搜索词, 让失败的搜索也能出现在历史中.
        syncStore?.upsert(.search(SearchPayload(query: trimmed)))
        await search()
    }

    /// Requests a throttled page sync when the screen appears.
    ///
    /// 页面出现时请求一次限频的页面同步.
    func refreshHistory() {
        guard let syncEngine else { return }
        Task { await syncEngine.requestSync(.page) }
    }

    func clearResults() {
        hasSearched = false
        results = []
    }

    func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }

        isSearching = true
        searchPhase = ""
        searchCompleted = 0
        searchTotal = 0

        let client = self.apiClient
        let searchQuery = trimmed
        do {
            // Keep SSE parsing off MainActor while progress updates hop back explicitly.
            //
            // SSE 解析不占用 MainActor, 进度更新通过显式 MainActor 跳转回 UI.
            let response: SearchResponse = try await Task.detached { [weak self] in
                try await client.searchStream(query: searchQuery) { progress in
                    await MainActor.run {
                        self?.searchPhase = progress.phase
                        self?.searchCompleted = progress.completed
                        self?.searchTotal = progress.total
                    }
                }
            }.value
            results = response.results
        } catch {
            // Fallback to sync search on SSE failure.
            //
            // SSE 失败时回退到同步搜索, 保证搜索功能仍可用.
            logger.warning("SSE search failed, falling back to sync: \(error.localizedDescription)")
            do {
                let response: SearchResponse = try await Task.detached {
                    try await client.search(query: searchQuery)
                }.value
                results = response.results
            } catch {
                logger.error("Search failed: \(error.localizedDescription)")
                results = []
                let message: String
                if let apiError = error as? APIError {
                    message = apiError.localizedMessage
                } else {
                    message = error.localizedDescription
                }
                ToastManager.shared.show(message)
            }
        }
        searchPhase = ""
        hasSearched = true
        isSearching = false
    }

    func search(query: String) async {
        self.query = query
        await search()
    }

    /// Clear search history on every device.
    ///
    /// 在所有设备上清空搜索历史.
    func clearHistory() {
        syncStore?.clear(.search)
    }
}
