import Foundation
import os

/// Phase of a streaming search as reported by the server.
///
/// 服务端流式搜索上报的阶段.
enum SearchPhase: String {
    case idle = ""
    case searching
    case probing
}

@Observable
@MainActor
final class SearchViewModel {
    var query = ""
    var results: [SearchResult] = []
    var isSearching = false
    var hasSearched = false
    var searchPhase: SearchPhase = .idle
    var searchCompleted: Int = 0
    var searchTotal: Int = 0

    /// Protocol dependency keeps network behavior replaceable in unit tests.
    ///
    /// 使用协议依赖让网络行为可以在单元测试中替换.
    private let apiClient: any SearchAPIProtocol
    private let syncStore: SyncStore?
    private let syncEngine: SyncEngine?
    private let logger = Logger(subsystem: "com.mritd.kmtv", category: "api")
    private var searchTask: Task<Void, Never>?
    /// Monotonic search generation; results of older generations are dropped.
    ///
    /// 单调递增的搜索代次, 旧代次的结果会被丢弃.
    private var searchGeneration = 0

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
        coverHint = ""
        resumeIntent = nil
        await search()
    }

    /// Requests a throttled page sync when the screen appears.
    ///
    /// 页面出现时请求一次限频的页面同步.
    func refreshHistory() {
        guard let syncEngine else { return }
        Task { await syncEngine.requestSync(.page) }
    }

    /// Drops the results and cancels any search in flight.
    ///
    /// 清空结果并取消正在进行的搜索.
    func clearResults() {
        searchTask?.cancel()
        searchTask = nil
        searchGeneration += 1
        isSearching = false
        hasSearched = false
        results = []
        searchPhase = .idle
        coverHint = ""
        resumeIntent = nil
    }

    /// Searches for `query`, replacing any search still running. Only the newest search may touch
    /// results, progress, and the searching flag, so a slow older search cannot overwrite it.
    ///
    /// 搜索 `query` 并取代仍在运行的搜索. 只有最新的搜索能改动结果, 进度与搜索中标记, 因此较慢的旧搜索
    /// 无法覆盖新搜索.
    func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }

        searchTask?.cancel()
        searchGeneration += 1
        let generation = searchGeneration
        isSearching = true
        searchPhase = .idle
        searchCompleted = 0
        searchTotal = 0

        // The view model owns the search: only a newer search or `clearResults` cancels it. Leaving the
        // page cancels the view's task, and the results must still land for when the user returns.
        //
        // 搜索由 view model 持有: 只有更新的搜索或 `clearResults` 会取消它. 离开页面会取消视图的 task,
        // 而结果仍需在用户返回时就绪.
        let task = Task { await self.run(query: trimmed, generation: generation) }
        searchTask = task
        await task.value
    }

    func search(query: String) async {
        self.query = query
        await search()
    }

    /// Context of the search: the card cover and resume episode of the title the user came from.
    /// Navigation searches set them; `submitSearch` and `clearResults` clear them.
    ///
    /// 搜索上下文: 用户来源作品的卡片封面与续播剧集. 导航发起的搜索会设置它们, `submitSearch` 与
    /// `clearResults` 会清除.
    var coverHint = ""
    var resumeIntent: EpisodeResumeIntent?

    /// Starts a search opened from a card or the player, with that card's context.
    ///
    /// 以卡片的上下文发起从卡片或播放页打开的搜索.
    func search(_ request: SearchQuery) async {
        coverHint = request.coverHint
        resumeIntent = request.resumeIntent
        await search(query: request.query)
    }

    /// The player destination for a result, carrying the search context.
    ///
    /// 搜索结果对应的播放目的地, 带有搜索上下文.
    func destination(for result: SearchResult) -> PlayDestination {
        let source = result.sources.first
        return PlayDestination(
            title: result.title,
            sources: result.sources,
            sourceKey: source?.sourceKey ?? "",
            videoId: source?.videoId ?? "",
            coverHint: SearchView.bestCover(resultCover: result.cover, resultTitle: result.title,
                                            query: query, coverHint: coverHint),
            resumeIntent: resumeIntent
        )
    }

    /// Progress line shown while a search runs.
    ///
    /// 搜索进行时显示的进度文案.
    var progressText: String {
        switch searchPhase {
        case .searching:
            return String(localized: "Searching available sources \(searchCompleted) / \(searchTotal) ...")
        case .probing:
            return String(localized: "Probing CDN availability \(searchCompleted) / \(searchTotal) ...")
        case .idle:
            return String(localized: "Searching...")
        }
    }

    private func run(query: String, generation: Int) async {
        let client = apiClient
        var found: [SearchResult] = []
        do {
            let response = try await client.searchStream(query: query) { [weak self] progress in
                await self?.apply(progress, generation: generation)
            }
            found = response.results
        } catch {
            if Task.isCancelled || error is CancellationError { return abandon(generation) }
            // Fallback to sync search on SSE failure.
            //
            // SSE 失败时回退到同步搜索, 保证搜索功能仍可用.
            logger.warning("SSE search failed, falling back to sync: \(error.localizedDescription)")
            do {
                found = try await client.search(query: query).results
            } catch {
                if Task.isCancelled || error is CancellationError { return abandon(generation) }
                guard generation == searchGeneration else { return }
                logger.error("Search failed: \(error.localizedDescription)")
                let message: String
                if let apiError = error as? APIError {
                    message = apiError.localizedMessage
                } else {
                    message = error.localizedDescription
                }
                ToastManager.shared.show(message)
            }
        }
        guard generation == searchGeneration else { return }
        results = found
        searchPhase = .idle
        hasSearched = true
        isSearching = false
    }

    /// A cancelled search that is still the newest stops showing progress.
    ///
    /// 被取消但仍是最新的搜索不再显示进度.
    private func abandon(_ generation: Int) {
        if generation == searchGeneration { isSearching = false }
    }

    private func apply(_ progress: APIClient.SearchProgress, generation: Int) {
        guard generation == searchGeneration else { return }
        searchPhase = SearchPhase(rawValue: progress.phase) ?? .idle
        searchCompleted = progress.completed
        searchTotal = progress.total
    }

    /// Clear search history on every device.
    ///
    /// 在所有设备上清空搜索历史.
    func clearHistory() {
        syncStore?.clear(.search)
    }
}
