import SwiftUI

/// Registers the search and player destinations of an iOS tab stack, so a search or a playback
/// opened from the tab stays on the tab's own path.
///
/// 注册 iOS tab 导航栈的搜索与播放目标, 使从该 tab 打开的搜索或播放留在该 tab 自己的 path 中.
struct SearchAndPlayDestinations: ViewModifier {
    @Binding var path: NavigationPath

    func body(content: Content) -> some View {
        content
            .navigationDestination(for: SearchQuery.self) { search in
                SearchView(initialSearch: search, path: $path)
            }
            .navigationDestination(for: PlayDestination.self) { destination in
                PlayerView(destination: destination)
            }
    }
}

extension View {
    /// Registers the search and player destinations on the stack whose path is `path`.
    ///
    /// 在 path 为 `path` 的导航栈上注册搜索与播放目标.
    func searchAndPlayDestinations(path: Binding<NavigationPath>) -> some View {
        modifier(SearchAndPlayDestinations(path: path))
    }
}
