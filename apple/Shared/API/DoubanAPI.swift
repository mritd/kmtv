import Foundation

extension APIClient {

    /// Fetches the discovery home sections.
    /// 获取发现首页分区.
    func doubanHome() async throws -> DoubanHomeResponse {
        try await get("/api/v1/douban/home")
    }

    /// Fetches available Douban category filters.
    /// 获取可用的 Douban 分类筛选项.
    func doubanCategories() async throws -> DoubanCategoriesResponse {
        try await get("/api/v1/douban/categories")
    }

    /// Fetches a legacy category list page.
    /// 获取旧版分类列表分页.
    func doubanList(category: String, type: String, start: Int = 0, count: Int = 20) async throws -> DoubanListResponse {
        try await get("/api/v1/douban/list", query: [
            "category": category,
            "type": type,
            "start": String(start),
            "count": String(count),
        ])
    }

    /// Fetches a filtered recommendation page.
    /// 获取带筛选条件的推荐分页.
    func doubanRecommend(kind: String, tag: String = "", format: String = "", region: String = "", start: Int = 0, count: Int = 20) async throws -> DoubanListResponse {
        try await get("/api/v1/douban/recommend/filter", query: [
            "kind": kind,
            "tag": tag,
            "format": format,
            "region": region,
            "start": String(start),
            "count": String(count),
        ])
    }
}
