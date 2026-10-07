import Foundation
import os

@Observable
@MainActor
final class CategoriesViewModel {
    var categoryGroups: [CategoryGroup] = []
    var selectedGroupIndex = 0
    var selectedSubCategory: SubCategory?
    var selectedRegion: Region?
    var items: [DoubanItem] = []
    var isLoading = false
    var isLoadingMore = false
    var hasMore = true

    private let logger = Logger(subsystem: "com.mritd.kmtv", category: "categories")
    /// Protocol dependency keeps Douban discovery replaceable in unit tests.
    ///
    /// 使用协议依赖让 Douban 发现接口可以在单元测试中替换.
    private let apiClient: any DoubanAPIProtocol
    private var currentStart = 0
    private let pageSize = 20
    private let baseURL: String
    private let covers: CoverRegistry?
    private let toasts: any ToastPresenting
    private var fetchTask: Task<Void, Never>?
    /// Monotonic request generation used to ignore stale category responses.
    ///
    /// 单调递增的请求代次, 用于忽略过期分类响应.
    private var fetchGeneration = 0

    var selectedGroup: CategoryGroup? {
        guard categoryGroups.indices.contains(selectedGroupIndex) else { return nil }
        return categoryGroups[selectedGroupIndex]
    }

    /// `covers` learns the cards' covers (nil on tvOS and in tests that do not cover it); `toasts`
    /// shows load failures.
    ///
    /// `covers` 登记卡片封面 (tvOS 与不涉及它的测试中为 nil); `toasts` 显示加载失败提示.
    init(apiClient: any DoubanAPIProtocol, baseURL: String = "", covers: CoverRegistry?,
         toasts: any ToastPresenting = ToastManager.shared) {
        self.apiClient = apiClient
        self.baseURL = baseURL
        self.covers = covers
        self.toasts = toasts
    }

    /// The single refresh entry point for pull-to-refresh and the empty-state Retry button: loads
    /// the category groups when a previous load failed to bring them, otherwise reloads the items.
    ///
    /// 下拉刷新与空状态 "重试" 按钮共用的刷新入口: 此前分类分组加载失败时重新加载分组, 否则重新加载条目.
    func refresh() async {
        if categoryGroups.isEmpty {
            await loadCategories()
        } else {
            await fetchItems()
        }
    }

    func loadCategories() async {
        // Show the loading state while groups load, so the empty state does not flash first.
        //
        // 分组加载期间显示加载状态, 避免先闪现空状态.
        isLoading = true
        do {
            let response = try await apiClient.doubanCategories()
            categoryGroups = response.categories
            if let firstGroup = categoryGroups.first {
                selectedSubCategory = firstGroup.subcategories.first
                selectedRegion = firstGroup.regions.first
            }
            await fetchItems()
        } catch {
            isLoading = false
            if isCancellation(error) { return }
            logger.error("Failed to load categories: \(error.localizedDescription)")
            handleError(error)
        }
    }

    func selectGroup(at index: Int) {
        guard index != selectedGroupIndex, categoryGroups.indices.contains(index) else { return }
        selectedGroupIndex = index
        let group = categoryGroups[index]
        selectedSubCategory = group.subcategories.first
        selectedRegion = group.regions.first
        fetchTask?.cancel()
        fetchTask = Task { [weak self] in await self?.fetchItems() }
    }

    func selectSubCategory(_ sub: SubCategory) {
        guard sub.id != selectedSubCategory?.id else { return }
        selectedSubCategory = sub
        fetchTask?.cancel()
        fetchTask = Task { [weak self] in await self?.fetchItems() }
    }

    func selectRegion(_ region: Region) {
        guard region.id != selectedRegion?.id else { return }
        selectedRegion = region
        fetchTask?.cancel()
        fetchTask = Task { [weak self] in await self?.fetchItems() }
    }

    func fetchItems() async {
        guard let group = selectedGroup else { return }
        // Bump generation before each full reload so older responses cannot overwrite new filters.
        //
        // 每次完整刷新前递增代次, 避免旧请求覆盖新的筛选结果.
        fetchGeneration += 1
        let gen = fetchGeneration
        isLoading = true
        // A page load of the previous generation leaves the flag alone when it returns, so clear it
        // here, or the load-more spinner stays and paging stops.
        //
        // 上一代次的分页加载返回时不会改动该标记, 因此在此清除; 否则 "加载更多" 的转圈会一直显示,
        // 分页也随之停止.
        isLoadingMore = false
        currentStart = 0
        hasMore = true
        defer { if gen == fetchGeneration { isLoading = false } }

        let query = currentQuery(group)

        do {
            let response = try await apiClient.doubanRecommend(
                kind: query.kind, tag: query.tag, format: query.format, region: query.region,
                start: 0, count: pageSize)
            // Ignore stale responses after the user changed category filters.
            //
            // 用户切换分类筛选后, 忽略过期的响应.
            guard gen == fetchGeneration else { return }
            items = response.items
            covers?.remember(response.items, baseURL: baseURL)
            currentStart = response.items.count
            hasMore = response.items.count >= pageSize
        } catch {
            guard gen == fetchGeneration, !isCancellation(error) else { return }
            logger.error("Failed to fetch items: \(error.localizedDescription)")
            handleError(error)
            items = []
        }
    }

    func loadMore() async {
        guard !isLoadingMore, hasMore, let group = selectedGroup else { return }
        isLoadingMore = true
        let gen = fetchGeneration
        defer { if gen == fetchGeneration { isLoadingMore = false } }

        let query = currentQuery(group)
        let start = currentStart

        do {
            let response = try await apiClient.doubanRecommend(
                kind: query.kind, tag: query.tag, format: query.format, region: query.region,
                start: start, count: pageSize)
            guard gen == fetchGeneration else { return }
            // Deduplicate append results because upstream pages can overlap.
            //
            // 追加分页时去重, 因为上游分页结果可能重叠.
            let existingIds = Set(items.map(\.id))
            let newItems = response.items.filter { !existingIds.contains($0.id) }
            items.append(contentsOf: newItems)
            covers?.remember(newItems, baseURL: baseURL)
            currentStart += response.items.count
            hasMore = response.items.count >= pageSize
        } catch {
            guard gen == fetchGeneration, !isCancellation(error) else { return }
            logger.error("Failed to load more: \(error.localizedDescription)")
            handleError(error)
        }
    }

    /// The Douban query for the selected group, subcategory, and region.
    ///
    /// 当前所选分组, 子分类与地区对应的豆瓣查询.
    private func currentQuery(_ group: CategoryGroup) -> (kind: String, tag: String, format: String, region: String) {
        let sub = selectedSubCategory
        return (
            kind: sub?.kind ?? group.doubanKind,
            tag: sub?.tag ?? "",
            format: sub?.kind != nil ? (sub?.format ?? "") : group.format,
            region: selectedRegion?.value ?? ""
        )
    }

    private func isCancellation(_ error: Error) -> Bool {
        Task.isCancelled || error.isCancellation
    }

    private func handleError(_ error: Error) {
        toasts.show(error: error)
    }
}
