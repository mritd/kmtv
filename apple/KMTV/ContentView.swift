import SwiftUI

/// iOS root tabs, each with an independent navigation path.
/// Search and playback destinations stay on the tab that initiated the flow.
///
/// iOS 根 tab, 每个 tab 维护独立 navigation path. 搜索和播放目标保留在发起流程的 tab 内.
struct ContentView: View {
    @Environment(AppViewModel.self) private var appVM
    @Environment(DownloadManager.self) private var downloads
    @State private var homePath = NavigationPath()
    @State private var categoriesPath = NavigationPath()
    @State private var favoritesPath = NavigationPath()
    @State private var downloadsPath = NavigationPath()
    @State private var selectedTab = RootTab.home

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab(value: RootTab.home) {
                NavigationStack(path: $homePath) {
                    HomeView(path: $homePath)
                        .searchAndPlayDestinations(path: $homePath)
                }
            } label: {
                TabIcon(title: "Home", systemImage: "play.tv", isSelected: selectedTab == .home)
            }
            Tab(value: RootTab.categories) {
                NavigationStack(path: $categoriesPath) {
                    CategoriesView(path: $categoriesPath)
                        .searchAndPlayDestinations(path: $categoriesPath)
                }
            } label: {
                TabIcon(title: "Categories", systemImage: "square.grid.2x2", isSelected: selectedTab == .categories)
            }
            Tab(value: RootTab.favorites) {
                NavigationStack(path: $favoritesPath) {
                    FavoritesView(path: $favoritesPath)
                        .searchAndPlayDestinations(path: $favoritesPath)
                }
            } label: {
                TabIcon(title: "Favorites", systemImage: "star", isSelected: selectedTab == .favorites)
            }
            Tab(value: RootTab.downloads) {
                NavigationStack(path: $downloadsPath) {
                    DownloadsView(mode: .online)
                        .navigationDestination(for: PlayDestination.self) { dest in
                            PlayerView(destination: dest)
                        }
                }
            } label: {
                TabIcon(title: "Downloads", systemImage: "arrow.down.circle", isSelected: selectedTab == .downloads)
            }
            .badge(downloads.activeEpisodeCount)
            Tab(value: RootTab.me) {
                NavigationStack {
                    ProfileView()
                }
            } label: {
                TabIcon(title: "Me", systemImage: "person.crop.circle", isSelected: selectedTab == .me)
            }
        }
    }
}

/// The root tabs, for tracking which one is selected.
///
/// 根 tab, 用于记录当前选中项.
private enum RootTab: Hashable {
    case home, categories, favorites, downloads, me
}

/// A tab bar item: the selected tab shows the filled symbol, the others an outlined symbol at
/// semibold weight, so thin outlines stay legible over busy artwork behind the glass bar. The tab
/// bar would otherwise fill every icon.
///
/// tab 项: 选中项显示实心图标, 其余为 semibold 粗细的线性图标, 使细线条在玻璃 tab 栏后的复杂海报上
/// 仍然清晰. 否则 tab 栏会把所有图标换成实心.
private struct TabIcon: View {
    let title: LocalizedStringKey
    let systemImage: String
    let isSelected: Bool

    var body: some View {
        Label {
            Text(title)
        } icon: {
            Image(uiImage: Self.symbol(systemImage, filled: isSelected))
        }
        .environment(\.symbolVariants, isSelected ? .fill : .none)
    }

    private static func symbol(_ name: String, filled: Bool) -> UIImage {
        let config = UIImage.SymbolConfiguration(weight: filled ? .regular : .semibold)
        return UIImage(systemName: filled ? name + ".fill" : name, withConfiguration: config)
            ?? UIImage(systemName: name, withConfiguration: config)
            ?? UIImage()
    }
}
