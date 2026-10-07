import SwiftUI

struct FavoritesView: View {
    @Environment(AppViewModel.self) private var appVM
    @State private var viewModel: FavoritesViewModel?
    #if os(tvOS)
    var onSearch: ((SearchQuery) -> Void)?
    #else
    @Binding var path: NavigationPath
    #endif

    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass

    init(path: Binding<NavigationPath>) {
        self._path = path
    }
    #endif

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
        .navigationTitle("Favorites")
        .readableColumn(maxWidth: nil)
        #endif
        // The one entry point: builds the view model on first appearance and requests a page sync
        // on every appearance.
        //
        // 唯一入口: 首次出现时创建视图模型, 每次出现都请求一次页面同步.
        .task {
            if viewModel == nil {
                viewModel = FavoritesViewModel(syncStore: appVM.sync?.store, syncEngine: appVM.sync?.engine)
            }
            viewModel?.load()
        }
    }

    @ViewBuilder
    private func content(_ vm: FavoritesViewModel) -> some View {
        if vm.favorites.isEmpty {
            ContentUnavailableView("No Favorites", systemImage: "star", description: Text("Videos you favorite will appear here"))
        } else {
            #if os(iOS)
            iosGrid(vm)
            #else
            tvGrid(vm)
            #endif
        }
    }

    #if os(iOS)
    private func iosGrid(_ vm: FavoritesViewModel) -> some View {
        let metrics = MediaMetrics(sizeClass)
        return ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: metrics.gridMinimum, maximum: metrics.gridMaximum),
                                         spacing: metrics.posterSpacing)],
                      spacing: metrics.posterSpacing) {
                ForEach(vm.favorites) { item in
                    Button {
                        path.append(SearchQuery(query: item.title, coverHint: item.cover))
                    } label: {
                        VideoCard(title: item.title, cover: item.cover,
                                  subtitle: DisplayFormatters.metaLine([item.type, item.year], separator: " · "),
                                  apiClient: appVM.apiClient)
                    }
                    .buttonStyle(.pressable)
                    .contextMenu {
                        Button("Remove", systemImage: "star.slash", role: .destructive) { vm.remove(item) }
                    }
                    .accessibilityIdentifier("favoriteItem")
                    .accessibilityAction(named: Text("Remove")) { vm.remove(item) }
                }
            }
            .padding(.horizontal, Spacing.page)
            .padding(.vertical, Spacing.sm)
        }
    }
    #endif

    #if os(tvOS)
    private func tvGrid(_ vm: FavoritesViewModel) -> some View {
        ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 32), count: 5), spacing: 32) {
                ForEach(vm.favorites) { item in
                    Button {
                        onSearch?(SearchQuery(query: item.title, coverHint: item.cover))
                    } label: {
                        VideoCard(title: item.title, cover: item.cover,
                                  subtitle: DisplayFormatters.metaLine([item.type, item.year]),
                                  apiClient: appVM.apiClient)
                    }
                    .buttonStyle(.tvScale)
                    .contextMenu {
                        Button("Remove", role: .destructive) { vm.remove(item) }
                    }
                }
            }
            .padding(48)
        }
        .scrollClipDisabled()
    }
    #endif
}
