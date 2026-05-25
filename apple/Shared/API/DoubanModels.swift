import Foundation

/// Home discovery response.
/// 首页发现响应.
struct DoubanHomeResponse: Codable, Sendable {
    let sections: [HomeSection]
}

/// One home discovery section.
/// 首页发现中的单个分区.
struct HomeSection: Codable, Sendable, Identifiable {
    /// Stable section identity.
    /// 分区稳定标识.
    var id: String { name }
    let name: String
    let tag: String
    let type: String
    let items: [DoubanItem]
}

/// One Douban discovery item.
/// 单个 Douban 发现条目.
struct DoubanItem: Codable, Sendable, Identifiable {
    let id: String
    let title: String
    let cover: String
    let rate: String
    let year: String
}

/// Category filter metadata response.
/// 分类筛选元数据响应.
struct DoubanCategoriesResponse: Codable, Sendable {
    let categories: [CategoryGroup]
}

/// One top-level category group.
/// 顶层分类分组.
struct CategoryGroup: Codable, Sendable, Identifiable {
    /// Stable group identity.
    /// 分组稳定标识.
    var id: String { key }
    let key: String
    let name: String
    let doubanKind: String
    let format: String
    let subcategories: [SubCategory]
    let regions: [Region]

    enum CodingKeys: String, CodingKey {
        case key, name, format, subcategories, regions
        case doubanKind = "douban_kind"
    }
}

/// One sub-category filter option.
/// 单个子分类筛选项.
struct SubCategory: Codable, Sendable, Identifiable, Hashable {
    /// Stable sub-category identity.
    /// 子分类稳定标识.
    var id: String { name }
    let name: String
    let tag: String
    let kind: String?
    let format: String?
}

/// One region filter option.
/// 单个地区筛选项.
struct Region: Codable, Sendable, Identifiable, Hashable {
    /// Stable region identity.
    /// 地区稳定标识.
    var id: String { name }
    let name: String
    let value: String
}

/// Douban list page response.
/// Douban 列表分页响应.
struct DoubanListResponse: Codable, Sendable {
    let items: [DoubanItem]
}
