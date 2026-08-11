import SwiftUI

/// Stable tvOS tab selection values used instead of nested push navigation.
///
/// tvOS 的稳定 tab 选择值, 用于替代多层 push 导航.
enum TVTab: Int, Hashable {
    case home, categories, search, favorites, settings
}

/// tvOS root navigation switches tabs and passes pending searches into Search.
/// This keeps detail/search flows compatible with the flat TabView navigation contract.
///
/// tvOS 根导航通过切换 tab 并向 Search 传递 pending search 完成跨功能跳转,
/// 保持详情与搜索流程符合扁平 TabView 导航约束.
struct TVContentView: View {
    @Environment(AppViewModel.self) private var appVM
    @State private var selectedTab: TVTab = .home
    @State private var pendingSearch: SearchQuery?

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab("Home", systemImage: "house.fill", value: .home) {
                HomeView(onSearch: { navigateToSearch($0) })
            }
            Tab("Categories", systemImage: "rectangle.grid.2x2.fill", value: .categories) {
                CategoriesView(onSearch: { navigateToSearch($0) })
            }
            Tab("Search", systemImage: "magnifyingglass", value: .search) {
                SearchView(pendingSearch: $pendingSearch)
            }
            Tab("Favorites", systemImage: "star.fill", value: .favorites) {
                FavoritesView(onSearch: { navigateToSearch($0) })
            }
            Tab("Settings", systemImage: "gearshape.fill", value: .settings) {
                TVSettingsView()
            }
        }
        .tint(.white)
    }

    private func navigateToSearch(_ search: SearchQuery) {
        // Set the payload before selecting Search so its task observes the new query.
        //
        // 先设置 payload 再选择 Search, 确保该页面的 task 能读到新 query.
        pendingSearch = search
        selectedTab = .search
    }
}
