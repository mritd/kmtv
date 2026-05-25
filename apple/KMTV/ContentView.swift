import SwiftUI

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
                            SearchView(initialQuery: sq.query, path: $homePath)
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
                            SearchView(initialQuery: sq.query, path: $categoriesPath)
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
                            SearchView(initialQuery: sq.query, path: $favoritesPath)
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
