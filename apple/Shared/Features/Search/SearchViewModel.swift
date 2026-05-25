import Foundation
import os
import SwiftData

@Observable
@MainActor
final class SearchViewModel {
    var query = ""
    var results: [SearchResult] = []
    var searchHistory: [SearchHistoryItem] = []
    var isSearching = false
    var hasSearched = false
    var searchPhase: String = ""
    var searchCompleted: Int = 0
    var searchTotal: Int = 0

    /// Protocol dependency keeps network behavior replaceable in unit tests.
    /// 使用协议依赖让网络行为可以在单元测试中替换.
    private let apiClient: any SearchAPIProtocol
    private let modelContext: ModelContext
    private let serverURL: String
    private let logger = Logger(subsystem: "com.mritd.kmtv", category: "api")

    init(apiClient: any SearchAPIProtocol, modelContext: ModelContext, serverURL: String) {
        self.apiClient = apiClient
        self.modelContext = modelContext
        self.serverURL = serverURL
    }

    func loadHistory() {
        // Search history is scoped by server URL so multiple servers do not leak queries.
        // 搜索历史按服务器地址隔离, 避免多个服务器之间泄露搜索词.
        searchHistory = SearchHistoryItem.recent(in: modelContext, serverURL: serverURL)
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

        // Persist the query before network work so the UI remembers attempted searches too.
        // 网络请求前先保存搜索词, 让失败的搜索也能出现在历史中.
        SearchHistoryItem.add(in: modelContext, serverURL: serverURL, query: trimmed)
        loadHistory()

        let client = self.apiClient
        let searchQuery = trimmed
        do {
            // Keep SSE parsing off MainActor while progress updates hop back explicitly.
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

    func clearHistory() {
        // Clear only this server's search history.
        // 只清理当前服务器的搜索历史.
        SearchHistoryItem.clearAll(in: modelContext, serverURL: serverURL)
        try? modelContext.save()
        searchHistory = []
    }
}
