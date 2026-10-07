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
        ScrollView {
            PosterGrid {
                ForEach(vm.favorites) { item in
                    Button {
                        path.append(SearchQuery(query: item.title, coverHint: item.cover))
                    } label: {
                        VideoCard(title: item.title, cover: item.cover,
                                  subtitle: DisplayFormatters.metaLine([item.type, item.year], separator: " · "),
                                  baseURL: appVM.apiClient?.baseURL)
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
            PosterGrid {
                ForEach(vm.favorites) { item in
                    Button {
                        onSearch?(SearchQuery(query: item.title, coverHint: item.cover))
                    } label: {
                        VideoCard(title: item.title, cover: item.cover,
                                  subtitle: DisplayFormatters.metaLine([item.type, item.year]),
                                  baseURL: appVM.apiClient?.baseURL)
                    }
                    .buttonStyle(.tvScale)
                    .contextMenu {
                        Button("Remove", role: .destructive) { vm.remove(item) }
                    }
                }
            }
            .padding(TVSpacing.page)
        }
        .scrollClipDisabled()
    }
    #endif
}
