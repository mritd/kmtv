import SwiftUI
import Kingfisher
import SkeletonUI

struct SearchView: View {
    @Environment(AppViewModel.self) private var appVM
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: SearchViewModel?
    @State private var coverHint = ""
    @State private var resumeIntent: EpisodeResumeIntent?
    #if os(tvOS)
    @Binding var pendingSearch: SearchQuery?
    @State private var selectedPlay: PlayDestination?
    #else
    var initialSearch: SearchQuery?
    @Binding var path: NavigationPath
    #endif

    #if os(iOS)
    init(initialSearch: SearchQuery? = nil, path: Binding<NavigationPath> = .constant(NavigationPath())) {
        self.initialSearch = initialSearch
        self._path = path
    }
    #endif

    var body: some View {
        Group {
            if let viewModel {
                #if os(tvOS)
                TVSearchContentView(viewModel: viewModel, appVM: appVM,
                                    coverHint: $coverHint,
                                    resumeIntent: $resumeIntent,
                                    onPlay: { selectedPlay = $0 })
                #else
                SearchContentView(viewModel: viewModel, path: $path, appVM: appVM,
                                  coverHint: $coverHint,
                                  resumeIntent: $resumeIntent)
                #endif
            } else {
                ProgressView()
            }
        }
        #if os(iOS)
        .background(Theme.bgPrimary)
        .navigationTitle("Search")
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task {
            if viewModel == nil, let client = appVM.apiClient {
                let vm = SearchViewModel(apiClient: client, modelContext: modelContext, serverURL: appVM.serverURL)
                viewModel = vm
                vm.loadHistory()
                #if os(tvOS)
                if let search = pendingSearch, !search.query.isEmpty {
                    pendingSearch = nil
                    await runSearch(search, with: vm)
                }
                #else
                if let initialSearch, !initialSearch.query.isEmpty {
                    await runSearch(initialSearch, with: vm)
                }
                #endif
            }
        }
        #if os(tvOS)
        .onChange(of: pendingSearch) { _, search in
            guard let search, !search.query.isEmpty else { return }
            guard let viewModel else { return }
            pendingSearch = nil
            Task { await runSearch(search, with: viewModel) }
        }
        .fullScreenCover(item: $selectedPlay) { dest in
            DetailView(title: dest.title, sources: dest.sources,
                       sourceKey: dest.sourceKey, videoId: dest.videoId,
                       coverHint: dest.coverHint,
                       resumeIntent: dest.resumeIntent)
        }
        #endif
    }

    private func runSearch(_ search: SearchQuery, with viewModel: SearchViewModel) async {
        coverHint = search.coverHint
        resumeIntent = search.resumeIntent
        viewModel.query = search.query
        await viewModel.search(query: search.query)
    }

    static func bestCover(resultCover: String, coverHint: String) -> String {
        resultCover.isEmpty ? coverHint : resultCover
    }
}

#if os(tvOS)
struct TVSearchContentView: View {
    @Bindable var viewModel: SearchViewModel
    let appVM: AppViewModel
    @Binding var coverHint: String
    @Binding var resumeIntent: EpisodeResumeIntent?
    var onPlay: ((PlayDestination) -> Void)?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                if viewModel.isSearching {
                    if !viewModel.searchPhase.isEmpty {
                        tvSearchProgress
                    }
                    tvSearchSkeleton
                } else if !viewModel.results.isEmpty {
                    tvSearchResults
                } else if viewModel.hasSearched && !viewModel.isSearching {
                    ContentUnavailableView("No results found", systemImage: "magnifyingglass")
                }
            }
            .padding(48)
        }
        .scrollClipDisabled()
        .searchable(text: $viewModel.query, prompt: "Search videos...")
        .onSubmit(of: .search) {
            coverHint = ""
            resumeIntent = nil
            Task { await viewModel.search() }
        }
    }

    private var tvSearchProgress: some View {
        HStack(spacing: 12) {
            ProgressView()
            Text(progressText)
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }

    private var progressText: String {
        let completed = viewModel.searchCompleted
        let total = viewModel.searchTotal
        switch viewModel.searchPhase {
        case "searching":
            return String(localized: "Searching available sources \(completed) / \(total) ...")
        case "probing":
            return String(localized: "Probing CDN availability \(completed) / \(total) ...")
        default:
            return String(localized: "Searching...")
        }
    }

    private var tvSearchResults: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 32), count: 5), spacing: 32) {
            // Search aggregation can return duplicate business ids; use row index for SwiftUI identity.
            // 聚合搜索可能返回重复业务 id, 这里使用行下标作为 SwiftUI 渲染标识.
            ForEach(searchRows) { row in
                let result = row.result
                Button {
                    let source = result.sources.first
                    let dest = PlayDestination(
                        title: result.title,
                        sources: result.sources,
                        sourceKey: source?.sourceKey ?? "",
                        videoId: source?.videoId ?? "",
                        coverHint: SearchView.bestCover(resultCover: result.cover, coverHint: coverHint),
                        resumeIntent: resumeIntent
                    )
                    onPlay?(dest)
                } label: {
                    VideoCard(
                        title: result.title,
                        cover: result.cover,
                        subtitle: "\(result.type) | \(result.year)",
                        rating: nil,
                        apiClient: appVM.apiClient
                    )
                }
                .buttonStyle(.tvScale)
                .accessibilityIdentifier("searchResult")
            }
        }
    }

    private var tvSearchSkeleton: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 32), count: 5), spacing: 32) {
            ForEach((0..<10).map(SearchRowIdentity.skeleton), id: \.self) { _ in
                VStack(alignment: .leading, spacing: 4) {
                    RoundedRectangle(cornerRadius: 8)
                        .skeleton(with: true, shape: .rounded(.radius(8, style: .continuous)))
                        .aspectRatio(2/3, contentMode: .fit)
                    RoundedRectangle(cornerRadius: 3)
                        .skeleton(with: true, shape: .rounded(.radius(3, style: .continuous)))
                        .frame(height: 12)
                }
            }
        }
    }

    private var searchRows: [SearchResultRow] {
        viewModel.results.enumerated().map { offset, result in
            SearchResultRow(id: .result(offset), result: result)
        }
    }
}
#endif

struct SearchContentView: View {
    @Bindable var viewModel: SearchViewModel
    @Binding var path: NavigationPath
    let appVM: AppViewModel
    @Binding var coverHint: String
    @Binding var resumeIntent: EpisodeResumeIntent?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(Theme.textSecondary)
                SearchTextField(
                    text: $viewModel.query,
                    placeholder: String(localized: "Search videos..."),
                    onSubmit: {
                        coverHint = ""
                        resumeIntent = nil
                        Task { await viewModel.search() }
                    }
                )
                .frame(height: 22)
                if !viewModel.query.isEmpty {
                    Button {
                        coverHint = ""
                        resumeIntent = nil
                        viewModel.query = ""
                        viewModel.clearResults()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(Theme.textSecondary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(Theme.bgSecondary)
            )
            .padding()

            ScrollView {
                LazyVStack(spacing: 0) {
                    if viewModel.isSearching {
                        if !viewModel.searchPhase.isEmpty {
                            searchProgressView
                        }
                        searchSkeleton
                    } else if !viewModel.results.isEmpty {
                        searchResults
                    } else if viewModel.hasSearched && !viewModel.isSearching {
                        emptyState
                    } else {
                        historySection
                    }
                }
            }
        }
    }

    private var searchResults: some View {
        // Search aggregation can return duplicate business ids; use row index for SwiftUI identity.
        // 聚合搜索可能返回重复业务 id, 这里使用行下标作为 SwiftUI 渲染标识.
        ForEach(searchRows) { row in
            let result = row.result
            Button {
                let source = result.sources.first
                path.append(PlayDestination(
                    title: result.title,
                    sources: result.sources,
                    sourceKey: source?.sourceKey ?? "",
                    videoId: source?.videoId ?? "",
                    coverHint: SearchView.bestCover(resultCover: result.cover, coverHint: coverHint),
                    resumeIntent: resumeIntent
                ))
            } label: {
                searchResultRow(result)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("searchResult")
        }
    }

    private func searchResultRow(_ result: SearchResult) -> some View {
        HStack(alignment: .center, spacing: 12) {
            KFImage(coverURL(result.cover))
                .placeholder {
                    RoundedRectangle(cornerRadius: 6).fill(Theme.bgCard)
                        .overlay {
                            Image(systemName: "film").foregroundStyle(Theme.textSecondary)
                        }
                }
                .fade(duration: 0.25)
                .resizable()
                .aspectRatio(2/3, contentMode: .fill)
                .frame(width: 80, height: 120)
                .clipShape(RoundedRectangle(cornerRadius: 6))

            VStack(alignment: .leading, spacing: 4) {
                Text(result.title)
                    .font(.body.bold())
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(2)
                Text("\(result.type) | \(result.year)")
                    .font(.subheadline)
                    .foregroundStyle(Theme.textSecondary)
                if let desc = DisplayFormatters.bestDescription(title: result.title, desc: result.desc) {
                    Text(desc)
                        .font(.caption)
                        .foregroundStyle(Theme.textSecondary.opacity(0.7))
                        .lineLimit(2)
                } else {
                    Text("No description available")
                        .font(.caption)
                        .foregroundStyle(Theme.textSecondary.opacity(0.4))
                        .italic()
                }
                HStack(spacing: 8) {
                    HStack(spacing: 4) {
                        Image(systemName: "server.rack")
                            .font(.caption2)
                        Text("\(result.sources.count) sources")
                            .font(.caption)
                    }
                    if let source = result.sources.first, source.durationMs > 0 {
                        Text(DisplayFormatters.latency(source.durationMs))
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Theme.accent.opacity(0.2))
                            .clipShape(Capsule())
                    }
                }
                .foregroundStyle(Theme.textSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
    }

    private func coverURL(_ cover: String) -> URL? {
        guard !cover.isEmpty else { return nil }
        if cover.hasPrefix("/"), let client = appVM.apiClient {
            return URL(string: client.baseURL + cover)
        }
        return URL(string: cover)
    }

    private var searchSkeleton: some View {
        ForEach((0..<4).map(SearchRowIdentity.skeleton), id: \.self) { _ in
            HStack(alignment: .center, spacing: 12) {
                RoundedRectangle(cornerRadius: 6)
                    .skeleton(with: true, shape: .rounded(.radius(6, style: .continuous)))
                    .frame(width: 80, height: 120)

                VStack(alignment: .leading, spacing: 8) {
                    RoundedRectangle(cornerRadius: 3)
                        .skeleton(with: true, shape: .rounded(.radius(3, style: .continuous)))
                        .frame(width: 160, height: 16)
                    RoundedRectangle(cornerRadius: 3)
                        .skeleton(with: true, shape: .rounded(.radius(3, style: .continuous)))
                        .frame(width: 100, height: 12)
                    RoundedRectangle(cornerRadius: 3)
                        .skeleton(with: true, shape: .rounded(.radius(3, style: .continuous)))
                        .frame(width: 200, height: 12)
                }
                Spacer()
            }
            .padding(.horizontal)
            .padding(.vertical, 10)
        }
    }

    private var searchRows: [SearchResultRow] {
        viewModel.results.enumerated().map { offset, result in
            SearchResultRow(id: .result(offset), result: result)
        }
    }

    private var searchProgressView: some View {
        HStack(spacing: 8) {
            ProgressView()
                #if os(iOS)
                .controlSize(.small)
                #endif
            Text(progressText)
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
        }
        .accessibilityIdentifier("searchProgress")
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    private var progressText: String {
        let completed = viewModel.searchCompleted
        let total = viewModel.searchTotal
        switch viewModel.searchPhase {
        case "searching":
            return String(localized: "Searching available sources \(completed) / \(total) ...")
        case "probing":
            return String(localized: "Probing CDN availability \(completed) / \(total) ...")
        default:
            return String(localized: "Searching...")
        }
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.largeTitle)
                .foregroundStyle(Theme.textSecondary.opacity(0.5))
            Text("No results found")
                .foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
    }

    private var historySection: some View {
        Group {
            if !viewModel.searchHistory.isEmpty {
                HStack {
                    Text("Search History")
                        .font(.headline)
                        .foregroundStyle(Theme.textPrimary)
                    Spacer()
                    Button("Clear") { viewModel.clearHistory() }
                        .font(.caption)
                        .foregroundStyle(Theme.textSecondary)
                }
                .padding(.top, 8)
                .padding(.horizontal)

                FlowLayout(spacing: 8) {
                    ForEach(viewModel.searchHistory, id: \.query) { item in
                        Button {
                            coverHint = ""
                            resumeIntent = nil
                            Task { await viewModel.search(query: item.query) }
                        } label: {
                            Text(item.query)
                                .font(.caption)
                                .foregroundStyle(Theme.textPrimary)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(Theme.bgSecondary)
                                .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal)
            }
        }
    }
}

private struct SearchResultRow: Identifiable {
    /// Namespaced identity avoids SwiftUI reusing skeleton rows for real results.
    /// 带命名空间的标识避免 SwiftUI 将骨架屏行复用为真实结果行.
    let id: SearchRowIdentity
    let result: SearchResult
}
