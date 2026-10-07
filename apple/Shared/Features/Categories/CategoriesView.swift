import SwiftUI

struct CategoriesView: View {
    @Environment(AppViewModel.self) private var appVM
    /// Learns the category cards' covers; absent on tvOS.
    ///
    /// 登记分类卡片的封面; tvOS 上不存在.
    @Environment(CoverRegistry.self) private var covers: CoverRegistry?
    #if os(tvOS)
    var onSearch: ((SearchQuery) -> Void)?
    #else
    @Binding var path: NavigationPath
    #endif
    @State private var viewModel: CategoriesViewModel?

    var body: some View {
        Group {
            if let viewModel {
                content(viewModel)
            } else {
                ProgressView()
            }
        }
        #if os(iOS)
        .background(Surface.canvas)
        .navigationTitle(Text("Back", comment: "Navigation back button title"))
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
                let vm = CategoriesViewModel(apiClient: client, baseURL: client.baseURL, covers: covers)
                viewModel = vm
                // The first load runs in its own task: leaving the tab cancels this view task, and a
                // cancelled first load would leave the page empty, with no refresh on tvOS.
                //
                // 首次加载在独立任务中执行: 切换标签页会取消视图的 task, 而被取消的首次加载会让页面一直为空,
                // tvOS 上也没有刷新手段.
                await Task { await vm.loadCategories() }.value
            }
        }
        // No cancel on disappear: the view model's generation already drops stale responses, and
        // cancelling a filter change on a tab switch left the old items under the new chip.
        //
        // 消失时不取消请求: 视图模型的代次已会丢弃过期响应, 而切换标签页时取消筛选请求会让旧条目留在
        // 新选中的筛选下.
    }

    @ViewBuilder
    private func content(_ vm: CategoriesViewModel) -> some View {
        #if os(tvOS)
        tvContent(vm)
        #else
        CategoriesBrowser(vm: vm, baseURL: appVM.apiClient?.baseURL)
        #endif
    }

    #if os(tvOS)
    @ViewBuilder
    private func tvContent(_ vm: CategoriesViewModel) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                VStack(spacing: 0) {
                    mainCategoryTabs(vm)
                    if let group = vm.selectedGroup {
                        subCategoryChips(vm, group: group)
                        if !group.regions.isEmpty {
                            regionChips(vm, group: group)
                        }
                    }
                }
                .focusSection()

                if vm.isLoading {
                    skeletonGrid
                } else if vm.items.isEmpty {
                    emptyState
                } else {
                    tvItemGrid(vm)
                }
            }
        }
        .scrollClipDisabled()
    }

    @ViewBuilder
    private func tvItemGrid(_ vm: CategoriesViewModel) -> some View {
        PosterGrid {
            ForEach(vm.items) { item in
                Button {
                    onSearch?(SearchQuery(query: item.title, coverHint: item.cover))
                } label: {
                    VideoCard(
                        title: item.title,
                        cover: item.cover,
                        subtitle: item.year,
                        rating: item.rate,
                        baseURL: appVM.apiClient?.baseURL
                    )
                }
                .buttonStyle(.tvScale)
                .accessibilityIdentifier("categoryItem_\(item.id)")
                .onAppear {
                    if item.id == vm.items.last?.id {
                        Task { await vm.loadMore() }
                    }
                }
            }
        }
        .padding(TVSpacing.page)
        .focusSection()
    }
    #endif

    #if os(tvOS)
    private func mainCategoryTabs(_ vm: CategoriesViewModel) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 24) {
                ForEach(Array(vm.categoryGroups.enumerated()), id: \.element.id) { index, group in
                    Button {
                        vm.selectGroup(at: index)
                    } label: {
                        TVCategoryTabLabel(
                            text: LocalizedStringKey(group.name),
                            isSelected: index == vm.selectedGroupIndex
                        )
                    }
                    .buttonStyle(.tvPlain)
                    .accessibilityIdentifier("mainCategory_\(group.key)")
                }
            }
            .padding(.horizontal, TVSpacing.page)
        }
        .padding(.top, 4)
    }

    private func subCategoryChips(_ vm: CategoriesViewModel, group: CategoryGroup) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(group.subcategories.filter { !$0.name.isEmpty }) { sub in
                    let isSelected = sub.id == vm.selectedSubCategory?.id
                    Button {
                        vm.selectSubCategory(sub)
                    } label: {
                        TVChipLabel(
                            text: LocalizedStringKey(sub.name),
                            isSelected: isSelected
                        )
                    }
                    .buttonStyle(.tvPlain)
                    .accessibilityIdentifier("subCategory_\(sub.name)")
                }
            }
            .padding(.horizontal, TVSpacing.page)
        }
        .padding(.top, 12)
        .padding(.bottom, 6)
    }

    private func regionChips(_ vm: CategoriesViewModel, group: CategoryGroup) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(group.regions.filter { !$0.name.isEmpty }) { region in
                    let isSelected = region.id == vm.selectedRegion?.id
                    Button {
                        vm.selectRegion(region)
                    } label: {
                        TVChipLabel(
                            text: LocalizedStringKey(region.name),
                            isSelected: isSelected,
                            isSmall: true
                        )
                    }
                    .buttonStyle(.tvPlain)
                    .accessibilityIdentifier("region_\(region.name)")
                }
            }
            .padding(.horizontal, TVSpacing.page)
        }
        .padding(.bottom, 12)
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("No results found", systemImage: "film")
        } actions: {
            Button("Retry") { Task { await viewModel?.refresh() } }
                .accessibilityIdentifier("categoriesRetry")
        }
        .accessibilityIdentifier("categoriesEmptyState")
    }

    private var skeletonGrid: some View {
        ScrollView {
            PosterSkeletonGrid(count: 9, showsMeta: true)
                .padding(TVSpacing.page)
        }
    }

    #endif
}
