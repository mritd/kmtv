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
    /// 使用协议依赖让 Douban 发现接口可以在单元测试中替换.
    private let apiClient: any DoubanAPIProtocol
    private var currentStart = 0
    private let pageSize = 20
    private var fetchTask: Task<Void, Never>?
    /// Monotonic request generation used to ignore stale category responses.
    /// 单调递增的请求代次, 用于忽略过期分类响应.
    private var fetchGeneration = 0

    var selectedGroup: CategoryGroup? {
        guard categoryGroups.indices.contains(selectedGroupIndex) else { return nil }
        return categoryGroups[selectedGroupIndex]
    }

    init(apiClient: any DoubanAPIProtocol) {
        self.apiClient = apiClient
    }

    func loadCategories() async {
        let client = self.apiClient
        do {
            let response: DoubanCategoriesResponse = try await Task.detached {
                try await client.doubanCategories()
            }.value
            categoryGroups = response.categories
            if let firstGroup = categoryGroups.first {
                selectedSubCategory = firstGroup.subcategories.first
                selectedRegion = firstGroup.regions.first
            }
            await fetchItems()
        } catch {
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
        // 每次完整刷新前递增代次, 避免旧请求覆盖新的筛选结果.
        fetchGeneration += 1
        let gen = fetchGeneration
        isLoading = true
        currentStart = 0
        hasMore = true
        defer { if gen == fetchGeneration { isLoading = false } }

        let client = self.apiClient
        let sub = selectedSubCategory
        let kind = sub?.kind ?? group.doubanKind
        let tag = sub?.tag ?? ""
        let format = sub?.kind != nil ? (sub?.format ?? "") : group.format
        let regionValue = selectedRegion?.value ?? ""

        do {
            let response: DoubanListResponse = try await Task.detached {
                try await client.doubanRecommend(kind: kind, tag: tag, format: format, region: regionValue, start: 0, count: 20)
            }.value
            // Ignore cancelled or stale responses after the user changed category filters.
            // 用户切换分类筛选后, 忽略已取消或过期的响应.
            guard !Task.isCancelled, gen == fetchGeneration else { return }
            items = response.items
            currentStart = response.items.count
            hasMore = response.items.count >= pageSize
        } catch {
            guard gen == fetchGeneration else { return }
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

        let client = self.apiClient
        let sub = selectedSubCategory
        let kind = sub?.kind ?? group.doubanKind
        let tag = sub?.tag ?? ""
        let format = sub?.kind != nil ? (sub?.format ?? "") : group.format
        let regionValue = selectedRegion?.value ?? ""
        let start = currentStart

        do {
            let response: DoubanListResponse = try await Task.detached {
                try await client.doubanRecommend(kind: kind, tag: tag, format: format, region: regionValue, start: start, count: 20)
            }.value
            guard gen == fetchGeneration else { return }
            // Deduplicate append results because upstream pages can overlap.
            // 追加分页时去重, 因为上游分页结果可能重叠.
            let existingIds = Set(items.map(\.id))
            let newItems = response.items.filter { !existingIds.contains($0.id) }
            items.append(contentsOf: newItems)
            currentStart += response.items.count
            hasMore = response.items.count >= pageSize
        } catch {
            guard gen == fetchGeneration else { return }
            logger.error("Failed to load more: \(error.localizedDescription)")
            handleError(error)
        }
    }

    func cancelFetch() {
        fetchTask?.cancel()
        fetchTask = nil
    }

    private func handleError(_ error: Error) {
        let message: String
        if let apiError = error as? APIError {
            message = apiError.localizedMessage
        } else {
            message = error.localizedDescription
        }
        ToastManager.shared.show(message)
    }
}
