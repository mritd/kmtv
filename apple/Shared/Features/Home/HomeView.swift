import SwiftUI

/// The home tab. This shell owns the data flow: it creates the view model, loads it once, refreshes
/// the watch history on every appearance, and routes a tapped card to search. The layout is per
/// platform: `HomeContentView` (HomeView+iOS.swift) and `TVHomeContentView` (HomeView+tvOS.swift).
///
/// 首页标签页. 本外壳负责数据流: 创建视图模型, 只加载一次, 每次出现时刷新观看历史, 并把点按的卡片
/// 转到搜索. 布局按平台区分: iOS 为 `HomeContentView` (HomeView+iOS.swift),
/// 而 tvOS 为 `TVHomeContentView` (HomeView+tvOS.swift).
struct HomeView: View {
    @Environment(AppViewModel.self) private var appVM
    /// Learns the home cards' covers; absent on tvOS.
    ///
    /// 登记首页卡片的封面; tvOS 上不存在.
    @Environment(CoverRegistry.self) private var covers: CoverRegistry?
    #if os(tvOS)
    var onSearch: ((SearchQuery) -> Void)?
    #else
    @Binding var path: NavigationPath
    #endif
    @State private var viewModel: HomeViewModel?

    var body: some View {
        Group {
            if let viewModel {
                #if os(tvOS)
                TVHomeContentView(vm: viewModel, baseURL: appVM.apiClient?.baseURL, onSearch: navigateToSearch)
                #else
                HomeContentView(vm: viewModel, baseURL: appVM.apiClient?.baseURL, covers: covers,
                                onSearch: navigateToSearch)
                #endif
            } else {
                ProgressView()
            }
        }
        #if os(iOS)
        .navigationTitle(Text("Back", comment: "Navigation back button title"))
        .background(Surface.canvas)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Color.clear.frame(height: 0)
            }
        }
        #endif
        .task {
            if viewModel == nil, let client = appVM.apiClient {
                let vm = HomeViewModel(apiClient: client, baseURL: client.baseURL, syncStore: appVM.sync?.store,
                                       syncEngine: appVM.sync?.engine, covers: covers)
                viewModel = vm
                // The first load runs in its own task: leaving the tab cancels this view task, and a
                // cancelled first load would leave the page empty, with no refresh on tvOS.
                //
                // 首次加载在独立任务中执行: 切换标签页会取消视图的 task, 而被取消的首次加载会让页面一直为空,
                // tvOS 上也没有刷新手段.
                await Task { await vm.load() }.value
            }
        }
        .onAppear {
            viewModel?.refreshWatchHistory()
        }
    }

    private func navigateToSearch(_ searchQuery: SearchQuery) {
        #if os(tvOS)
        onSearch?(searchQuery)
        #else
        path.append(searchQuery)
        #endif
    }
}
