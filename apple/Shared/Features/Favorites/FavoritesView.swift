import SwiftUI
import Kingfisher

struct FavoritesView: View {
    @Environment(AppViewModel.self) private var appVM
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: FavoritesViewModel?
    #if os(tvOS)
    var onSearch: ((SearchQuery) -> Void)?
    #else
    @Binding var path: NavigationPath
    #endif

    #if os(iOS)
    init(path: Binding<NavigationPath> = .constant(NavigationPath())) {
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
        .background(Theme.bgPrimary)
        .navigationTitle("Favorites")
        #endif
        .task {
            if viewModel == nil {
                let vm = FavoritesViewModel(modelContext: modelContext, serverURL: appVM.serverURL)
                viewModel = vm
                vm.load()
            }
        }
        .onAppear {
            viewModel?.load()
        }
    }

    @ViewBuilder
    private func content(_ vm: FavoritesViewModel) -> some View {
        if vm.favorites.isEmpty {
            ContentUnavailableView("No Favorites", systemImage: "star", description: Text("Videos you favorite will appear here"))
        } else {
            #if os(iOS)
            iosList(vm)
            #else
            tvGrid(vm)
            #endif
        }
    }

    #if os(iOS)
    private func iosList(_ vm: FavoritesViewModel) -> some View {
        List {
            ForEach(vm.favorites, id: \.persistentModelID) { item in
                Button {
                    path.append(SearchQuery(query: item.title))
                } label: {
                    favoriteRow(item)
                }
                .listRowBackground(Theme.bgCard)
            }
            .onDelete { indexSet in
                for i in indexSet {
                    vm.remove(vm.favorites[i])
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.bgPrimary)
    }

    private func favoriteRow(_ item: FavoriteItem) -> some View {
        HStack(spacing: 12) {
            KFImage(coverURL(item.cover))
                .placeholder {
                    RoundedRectangle(cornerRadius: 4).fill(Theme.bgCard)
                }
                .fade(duration: 0.25)
                .resizable()
                .aspectRatio(2/3, contentMode: .fill)
                .frame(width: 50, height: 75)
                .clipShape(RoundedRectangle(cornerRadius: 4))

            VStack(alignment: .leading, spacing: 4) {
                Text(item.title).font(.body)
                    .foregroundStyle(Theme.textPrimary)
                Text("\(item.type) | \(item.year)")
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
            }
        }
    }
    #endif

    #if os(tvOS)
    private func tvGrid(_ vm: FavoritesViewModel) -> some View {
        ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 32), count: 5), spacing: 32) {
                ForEach(vm.favorites, id: \.persistentModelID) { item in
                    Button {
                        onSearch?(SearchQuery(query: item.title))
                    } label: {
                        VideoCard(title: item.title, cover: item.cover,
                                  subtitle: "\(item.type) | \(item.year)",
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

    private func coverURL(_ cover: String) -> URL? {
        guard !cover.isEmpty else { return nil }
        if cover.hasPrefix("/"), let client = appVM.apiClient {
            return URL(string: client.baseURL + cover)
        }
        return URL(string: cover)
    }
}
