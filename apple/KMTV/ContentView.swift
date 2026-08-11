import SwiftUI

/// iOS root tabs, each with an independent navigation path.
/// Search and playback destinations stay on the tab that initiated the flow.
///
/// iOS 根 tab, 每个 tab 维护独立 navigation path. 搜索和播放目标保留在发起流程的 tab 内.
struct ContentView: View {
    @Environment(AppViewModel.self) private var appVM
    @State private var homePath = NavigationPath()
    @State private var categoriesPath = NavigationPath()
    @State private var favoritesPath = NavigationPath()

    var body: some View {
        TabView {
            Tab("Home", systemImage: "house.fill") {
                NavigationStack(path: $homePath) {
                    HomeView(path: $homePath)
                        .navigationDestination(for: SearchQuery.self) { sq in
                            SearchView(initialSearch: sq, path: $homePath)
                        }
                        .navigationDestination(for: PlayDestination.self) { dest in
                            PlayerView(destination: dest)
                        }
                }
            }
            Tab("Categories", systemImage: "rectangle.grid.2x2") {
                NavigationStack(path: $categoriesPath) {
                    CategoriesView(path: $categoriesPath)
                        .navigationDestination(for: SearchQuery.self) { sq in
                            SearchView(initialSearch: sq, path: $categoriesPath)
                        }
                        .navigationDestination(for: PlayDestination.self) { dest in
                            PlayerView(destination: dest)
                        }
                }
            }
            Tab("Favorites", systemImage: "star.fill") {
                NavigationStack(path: $favoritesPath) {
                    FavoritesView(path: $favoritesPath)
                        .navigationDestination(for: SearchQuery.self) { sq in
                            SearchView(initialSearch: sq, path: $favoritesPath)
                        }
                        .navigationDestination(for: PlayDestination.self) { dest in
                            PlayerView(destination: dest)
                        }
                }
            }
            Tab("Me", systemImage: "person.fill") {
                NavigationStack {
                    ProfileView()
                }
            }
        }
        .tint(Theme.accent)
    }
}
