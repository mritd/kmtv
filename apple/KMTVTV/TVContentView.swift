import SwiftUI

enum TVTab: Int, Hashable {
    case home, categories, search, favorites, settings
}

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
        pendingSearch = search
        selectedTab = .search
    }
}
