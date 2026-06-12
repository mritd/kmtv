import SwiftUI
import Kingfisher
import SkeletonUI

struct CategoriesView: View {
    @Environment(AppViewModel.self) private var appVM
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
        .background(Theme.bgPrimary)
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
                let vm = CategoriesViewModel(apiClient: client)
                viewModel = vm
                await vm.loadCategories()
            }
        }
        .onDisappear {
            viewModel?.cancelFetch()
        }
    }

    @ViewBuilder
    private func content(_ vm: CategoriesViewModel) -> some View {
        #if os(tvOS)
        tvContent(vm)
        #else
        VStack(spacing: 0) {
            HStack {
                Text("Categories")
                    .font(.title.bold())
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
            }
            .padding(.horizontal)
            .padding(.top, 8)
            .accessibilityIdentifier("categoriesTitle")

            Group {
                mainCategoryTabs(vm)
                if let group = vm.selectedGroup {
                    subCategoryChips(vm, group: group)
                    if !group.regions.isEmpty {
                        regionChips(vm, group: group)
                    }
                }
            }

            Group {
                if vm.isLoading {
                    skeletonGrid
                } else if vm.items.isEmpty {
                    emptyState
                } else {
                    itemGrid(vm)
                }
            }
        }
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
        LazyVGrid(columns: gridLayout, spacing: gridSpacing) {
            ForEach(vm.items) { item in
                Button {
                    onSearch?(SearchQuery(query: item.title, coverHint: item.cover))
                } label: {
                    VideoCard(
                        title: item.title,
                        cover: item.cover,
                        subtitle: item.year,
                        rating: item.rate,
                        apiClient: appVM.apiClient
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
        .padding(48)
        .focusSection()
    }
    #endif

    private func mainCategoryTabs(_ vm: CategoriesViewModel) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            #if os(tvOS)
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
            .padding(.horizontal, 48)
            #else
            HStack(spacing: 0) {
                ForEach(Array(vm.categoryGroups.enumerated()), id: \.element.id) { index, group in
                    Button {
                        vm.selectGroup(at: index)
                    } label: {
                        VStack(spacing: 8) {
                            Text(LocalizedStringKey(group.name))
                                .font(.subheadline.weight(index == vm.selectedGroupIndex ? .semibold : .regular))
                                .foregroundStyle(index == vm.selectedGroupIndex ? Theme.accent : Theme.textSecondary)
                                .padding(.horizontal, 16)
                            Rectangle()
                                .fill(index == vm.selectedGroupIndex ? Theme.accent : .clear)
                                .frame(height: 2)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("mainCategory_\(group.key)")
                }
            }
            #endif
        }
        .padding(.top, 4)
        #if os(iOS)
        .overlay(alignment: .bottom) {
            Divider().overlay(Theme.bgSecondary)
        }
        #endif
    }

    private func subCategoryChips(_ vm: CategoriesViewModel, group: CategoryGroup) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            #if os(tvOS)
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
            .padding(.horizontal, 48)
            #else
            HStack(spacing: 8) {
                ForEach(group.subcategories.filter { !$0.name.isEmpty }) { sub in
                    let isSelected = sub.id == vm.selectedSubCategory?.id
                    Button {
                        vm.selectSubCategory(sub)
                    } label: {
                        Text(LocalizedStringKey(sub.name))
                            .font(.caption.weight(isSelected ? .semibold : .regular))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 6)
                            .background(isSelected ? Theme.accent : Theme.bgCard)
                            .foregroundStyle(isSelected ? Theme.bgPrimary : Theme.textPrimary)
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("subCategory_\(sub.name)")
                }
            }
            .padding(.horizontal)
            #endif
        }
        .padding(.top, 12)
        .padding(.bottom, 6)
    }

    private func regionChips(_ vm: CategoriesViewModel, group: CategoryGroup) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            #if os(tvOS)
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
            .padding(.horizontal, 48)
            #else
            HStack(spacing: 6) {
                ForEach(group.regions.filter { !$0.name.isEmpty }) { region in
                    let isSelected = region.id == vm.selectedRegion?.id
                    Button {
                        vm.selectRegion(region)
                    } label: {
                        Text(LocalizedStringKey(region.name))
                            .font(.caption2)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(isSelected ? Theme.accent.opacity(0.2) : .clear)
                            .foregroundStyle(isSelected ? Theme.accent : Theme.textSecondary)
                            .overlay(
                                Capsule()
                                    .stroke(isSelected ? Theme.accent.opacity(0.4) : Theme.textSecondary.opacity(0.3), lineWidth: 1)
                            )
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("region_\(region.name)")
                }
            }
            .padding(.horizontal)
            #endif
        }
        .padding(.bottom, 12)
    }

    private func itemGrid(_ vm: CategoriesViewModel) -> some View {
        ScrollView {
            LazyVGrid(columns: gridLayout, spacing: gridSpacing) {
                ForEach(vm.items) { item in
                    #if os(tvOS)
                    Button {
                        onSearch?(SearchQuery(query: item.title, coverHint: item.cover))
                    } label: {
                        VideoCard(
                            title: item.title,
                            cover: item.cover,
                            subtitle: item.year,
                            rating: item.rate,
                            apiClient: appVM.apiClient
                        )
                    }
                    .buttonStyle(.tvScale)
                    .accessibilityIdentifier("categoryItem_\(item.id)")
                    .onAppear {
                        if item.id == vm.items.last?.id {
                            Task { await vm.loadMore() }
                        }
                    }
                    #else
                    NavigationLink(value: SearchQuery(query: item.title, coverHint: item.cover)) {
                        VideoCard(
                            title: item.title,
                            cover: item.cover,
                            subtitle: item.year,
                            rating: item.rate,
                            apiClient: appVM.apiClient
                        )
                    }
                    .buttonStyle(.plain)
                    .onAppear {
                        if item.id == vm.items.last?.id {
                            Task { await vm.loadMore() }
                        }
                    }
                    #endif
                }
            }
            #if os(tvOS)
            .padding(48)
            #else
            .padding(.horizontal)
            #endif

            if vm.isLoadingMore {
                ProgressView()
                    .padding()
            }
        }
        #if os(tvOS)
        .scrollClipDisabled()
        #elseif os(iOS)
        .refreshable {
            await vm.fetchItems()
        }
        #endif
    }

    private var gridSpacing: CGFloat {
        #if os(iOS)
        16
        #else
        32
        #endif
    }

    private var gridLayout: [GridItem] {
        #if os(iOS)
        [GridItem(.adaptive(minimum: Theme.cardWidth, maximum: Theme.cardWidth * 1.5), spacing: 10)]
        #else
        Array(repeating: GridItem(.flexible(), spacing: 32), count: 5)
        #endif
    }

    private var emptyState: some View {
        #if os(tvOS)
        ContentUnavailableView("No results found", systemImage: "film")
            .accessibilityIdentifier("categoriesEmptyState")
        #else
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "film")
                .font(.largeTitle)
                .foregroundStyle(Theme.textSecondary)
            Text("No results found")
                .font(.subheadline)
                .foregroundStyle(Theme.textSecondary)
                .accessibilityIdentifier("categoriesEmptyState")
            Spacer()
        }
        .frame(maxWidth: .infinity)
        #endif
    }

    private var skeletonGrid: some View {
        ScrollView {
            LazyVGrid(columns: gridLayout, spacing: gridSpacing) {
                ForEach(0..<9, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 4) {
                        RoundedRectangle(cornerRadius: 8)
                            .skeleton(with: true, shape: .rounded(.radius(8, style: .continuous)))
                            .aspectRatio(2/3, contentMode: .fit)
                        RoundedRectangle(cornerRadius: 3)
                            .skeleton(with: true, shape: .rounded(.radius(3, style: .continuous)))
                            .frame(height: 12)
                        RoundedRectangle(cornerRadius: 3)
                            .skeleton(with: true, shape: .rounded(.radius(3, style: .continuous)))
                            .frame(width: 40, height: 10)
                    }
                }
            }
            #if os(tvOS)
            .padding(48)
            #else
            .padding(.horizontal)
            #endif
        }
    }
}
