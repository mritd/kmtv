#if os(iOS)
import SwiftUI
import SkeletonUI

/// The iOS categories screen: category tiles, a filter bar, and a poster grid, all scrolling as one
/// page, with a back-to-top button once the page has scrolled down. On iPad the tiles are compact
/// capsules.
///
/// iOS 分类页面: 分类卡片, 筛选栏与海报网格, 整体作为一页滚动; 页面向下滚动后显示返回顶部按钮. iPad 上
/// 分类卡片为紧凑胶囊.
struct CategoriesBrowser: View {
    let vm: CategoriesViewModel
    let apiClient: APIClient?
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var position = ScrollPosition(edge: .top)
    @State private var scrolled = false
    @State private var showsBackToTop = false

    /// Scroll distance after which the back-to-top button appears: about two screens of posters.
    ///
    /// 返回顶部按钮出现所需的滚动距离: 约两屏海报.
    private static let backToTopDistance: CGFloat = 1200

    private var metrics: MediaMetrics { MediaMetrics(sizeClass) }

    private var columns: [GridItem] {
        [GridItem(.adaptive(minimum: metrics.gridMinimum, maximum: metrics.gridMaximum), spacing: metrics.posterSpacing)]
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    // On iPad the top tab bar already names the page, as on the other tabs.
                    //
                    // iPad 上顶部标签栏已标明当前页面, 与其他标签页一致.
                    if !metrics.regular {
                        Text("Categories")
                            .font(AppFont.display)
                            .accessibilityAddTraits(.isHeader)
                            .accessibilityIdentifier("categoriesTitle")
                    }
                    groupTiles
                }
                .padding(.horizontal, Spacing.page)
                .padding(.top, Spacing.sm)
                .padding(.bottom, Spacing.md)

                filterBar

                results
                    .padding(.horizontal, Spacing.page)
                    .padding(.top, Spacing.md)
                    .padding(.bottom, Spacing.xl)
            }
        }
        .scrollPosition($position)
        .refreshable { await vm.fetchItems() }
        .onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.y + $0.contentInsets.top } action: { _, offset in
            let nowScrolled = offset > 1
            if nowScrolled != scrolled { scrolled = nowScrolled }
            let nowShows = offset > Self.backToTopDistance
            if nowShows != showsBackToTop {
                withAnimation(.easeOut(duration: 0.2)) { showsBackToTop = nowShows }
            }
        }
        // There is no navigation bar, so once posters scroll under the status bar a material keeps
        // the clock and battery readable; at the top the page shows plain.
        //
        // 没有导航栏, 因此海报滚到状态栏下方后用材质背景保证时间与电量清晰可读; 位于顶部时页面保持素净.
        .overlay(alignment: .top) {
            Color.clear
                .frame(height: 0)
                .background(scrolled ? AnyShapeStyle(.bar) : AnyShapeStyle(.clear), ignoresSafeAreaEdges: .top)
        }
        .overlay(alignment: .bottomTrailing) {
            if showsBackToTop {
                Button {
                    withAnimation { position.scrollTo(edge: .top) }
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.primary)
                        .frame(width: 44, height: 44)
                        .background(.regularMaterial, in: Circle())
                        .shadow(color: .black.opacity(0.18), radius: 8, y: 3)
                }
                .buttonStyle(.pressable)
                .padding(Spacing.lg)
                .transition(.scale(scale: 0.6).combined(with: .opacity))
                .accessibilityLabel(Text("Back to Top"))
                .accessibilityIdentifier("backToTop")
            }
        }
        // No navigation bar on this root; the view's title still names the back button of pushed pages.
        //
        // 本根页面不显示导航栏; 页面标题仍用作推入页面的返回按钮文字.
        .toolbar(.hidden, for: .navigationBar)
    }

    // MARK: - Category tiles

    /// Equal-width tiles for up to four groups; more groups scroll sideways at a fixed width. On iPad
    /// the tiles turn into a row of compact capsules, since full-width tiles grow into slabs there.
    ///
    /// 不超过四个分组时等宽排列; 分组更多时以固定宽度横向滚动. iPad 上改为一排紧凑的胶囊, 因为全宽卡片
    /// 在大屏上会变成大块面板.
    @ViewBuilder
    private var groupTiles: some View {
        if metrics.regular {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.sm) { tiles }
                    .padding(.horizontal, Spacing.page)
            }
            .padding(.horizontal, -Spacing.page)
        } else if vm.categoryGroups.count <= 4 {
            HStack(spacing: Spacing.sm) { tiles }
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.sm) { tiles.frame(width: 84) }
                    .padding(.horizontal, Spacing.page)
            }
            .padding(.horizontal, -Spacing.page)
        }
    }

    private var tiles: some View {
        ForEach(Array(vm.categoryGroups.enumerated()), id: \.element.id) { index, group in
            CategoryTile(name: LocalizedStringKey(group.name), systemImage: Self.icon(for: group.key),
                         isSelected: index == vm.selectedGroupIndex, compact: metrics.regular) {
                vm.selectGroup(at: index)
            }
            .accessibilityIdentifier("mainCategory_\(group.key)")
        }
    }

    static func icon(for key: String) -> String {
        switch key {
        case "movie": "film"
        case "tv": "tv"
        case "anime": "sparkles"
        case "show": "music.mic"
        default: "square.grid.2x2"
        }
    }

    // MARK: - Filter bar

    @ViewBuilder
    private var filterBar: some View {
        if let group = vm.selectedGroup {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.sm) {
                    let regions = group.regions.filter { !$0.name.isEmpty }
                    if !regions.isEmpty {
                        regionMenu(regions)
                        Rectangle()
                            .fill(Surface.separator)
                            .frame(width: 1, height: 20)
                    }
                    ForEach(group.subcategories.filter { !$0.name.isEmpty }) { sub in
                        let isSelected = sub.id == vm.selectedSubCategory?.id
                        Button {
                            vm.selectSubCategory(sub)
                        } label: {
                            Text(LocalizedStringKey(sub.name))
                        }
                        .buttonStyle(.chip(selected: isSelected, minHeight: 34, capsule: true))
                        .accessibilityAddTraits(isSelected ? .isSelected : [])
                        .accessibilityIdentifier("subCategory_\(sub.name)")
                    }
                }
                .padding(.horizontal, Spacing.page)
                .padding(.vertical, Spacing.sm)
            }
        }
    }

    private func regionMenu(_ regions: [Region]) -> some View {
        Menu {
            ForEach(regions) { region in
                Button {
                    vm.selectRegion(region)
                } label: {
                    if region.id == vm.selectedRegion?.id {
                        Label(LocalizedStringKey(region.name), systemImage: "checkmark")
                    } else {
                        Text(LocalizedStringKey(region.name))
                    }
                }
                .accessibilityIdentifier("region_\(region.name)")
            }
        } label: {
            HStack(spacing: Spacing.xs) {
                Image(systemName: "globe")
                Text(LocalizedStringKey(vm.selectedRegion?.name ?? regions[0].name))
                Image(systemName: "chevron.down")
                    .font(.caption2.weight(.bold))
            }
        }
        .buttonStyle(.pill(selected: vm.selectedRegion?.id != regions.first?.id))
        .accessibilityLabel(Text("Region"))
        .accessibilityIdentifier("regionMenu")
    }

    // MARK: - Results

    @ViewBuilder
    private var results: some View {
        if vm.isLoading {
            skeleton
        } else if vm.items.isEmpty {
            ContentUnavailableView {
                Label("No results found", systemImage: "film")
                    .accessibilityIdentifier("categoriesEmptyState")
            }
            .padding(.top, Spacing.xxl)
        } else {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                LazyVGrid(columns: columns, spacing: metrics.posterSpacing) {
                    ForEach(vm.items) { item in
                        NavigationLink(value: SearchQuery(query: item.title, coverHint: item.cover)) {
                            VideoCard(title: item.title, cover: item.cover, subtitle: item.year,
                                      rating: item.rate, apiClient: apiClient)
                        }
                        .buttonStyle(.pressable)
                        .accessibilityIdentifier("categoryItem_\(item.id)")
                        .onAppear {
                            if item.id == vm.items.last?.id {
                                Task { await vm.loadMore() }
                            }
                        }
                    }
                }

                if vm.isLoadingMore {
                    ProgressView().frame(maxWidth: .infinity)
                }
            }
        }
    }

    private var skeleton: some View {
        LazyVGrid(columns: columns, spacing: metrics.posterSpacing) {
            // Enough cells to fill the first screen, so landscape is not left half empty.
            //
            // 足以填满第一屏, 横屏时不会空出半屏.
            ForEach(0..<(metrics.regular ? 16 : 9), id: \.self) { _ in
                VStack(alignment: .leading, spacing: 6) {
                    RoundedRectangle(cornerRadius: Radius.md)
                        .skeleton(with: true, shape: .rounded(.radius(Radius.md, style: .continuous)))
                        .aspectRatio(2/3, contentMode: .fit)
                    RoundedRectangle(cornerRadius: 3)
                        .skeleton(with: true, shape: .rounded(.radius(3, style: .continuous)))
                        .frame(height: 12)
                }
            }
        }
    }
}

/// One main category: a glyph over its name, or beside it when `compact`; the selected tile is
/// filled with the accent.
///
/// 一个主分类: 图标在名称上方, `compact` 时位于名称左侧; 选中的卡片用强调色填充.
private struct CategoryTile: View {
    let name: LocalizedStringKey
    let systemImage: String
    let isSelected: Bool
    var compact = false
    let action: () -> Void
    @Environment(\.appTheme) private var theme

    var body: some View {
        Button(action: action) {
            let layout = compact ? AnyLayout(HStackLayout(spacing: Spacing.sm)) : AnyLayout(VStackLayout(spacing: Spacing.xs + 2))
            layout {
                Image(systemName: systemImage)
                    .font(compact ? .body.weight(.semibold) : .title3.weight(.semibold))
                    .symbolVariant(isSelected ? .fill : .none)
                Text(name)
                    .font(AppFont.control)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .padding(.horizontal, compact ? Spacing.lg : 0)
            .frame(minWidth: compact ? 120 : nil, maxWidth: compact ? nil : .infinity, minHeight: compact ? 44 : 72)
            .foregroundStyle(isSelected ? theme.onAccent : Color.primary)
            .background(isSelected ? theme.accent : Surface.raised,
                        in: RoundedRectangle(cornerRadius: compact ? 22 : Radius.lg, style: .continuous))
            .shadow(color: isSelected ? .clear : Surface.shadow, radius: 1.5, y: 1)
            .animation(.easeOut(duration: 0.2), value: isSelected)
        }
        .buttonStyle(.pressable)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

#endif
