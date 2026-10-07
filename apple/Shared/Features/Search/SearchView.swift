import SwiftUI
import Kingfisher
import SkeletonUI

struct SearchView: View {
    @Environment(AppViewModel.self) private var appVM
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
        .background(Surface.canvas)
        .navigationTitle("Search")
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task {
            if viewModel == nil, let client = appVM.apiClient {
                let vm = SearchViewModel(apiClient: client, syncStore: appVM.sync?.store, syncEngine: appVM.sync?.engine)
                viewModel = vm
                vm.refreshHistory()
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
            } else {
                // Every later visit requests another throttled page sync.
                //
                // 之后每次进入页面都会再请求一次限频的页面同步.
                viewModel?.refreshHistory()
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

    /// The cover a result opens the player with. The card the user tapped (`coverHint`) wins when
    /// the result has that card's title: card covers come from Douban and load reliably, while some
    /// sources block requests for their own covers. Other results keep their own cover and fall
    /// back to the hint.
    ///
    /// 搜索结果打开播放页时使用的封面. 结果标题与用户点按的卡片一致时, 优先使用该卡片的封面
    /// (`coverHint`): 卡片封面来自豆瓣, 能稳定加载, 而部分源站会拦截对其自身封面的请求. 其他结果保留
    /// 自己的封面, 缺失时回退到提示封面.
    static func bestCover(resultCover: String, resultTitle: String, query: String, coverHint: String) -> String {
        if !coverHint.isEmpty, normalizeSyncKey(resultTitle) == normalizeSyncKey(query) { return coverHint }
        return resultCover.isEmpty ? coverHint : resultCover
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
            Task { await viewModel.submitSearch() }
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
            // SearchResult.id can collide across rows that share title/provider but differ by year.
            // Use the namespaced row index so SwiftUI never reuses a result or skeleton incorrectly.
            //
            // 同标题和视频源但年份不同的结果可能产生相同 SearchResult.id. 使用带命名空间的
            // 行下标, 避免 SwiftUI 错误复用结果行或骨架行.
            ForEach(searchRows) { row in
                let result = row.result
                Button {
                    let source = result.sources.first
                    let dest = PlayDestination(
                        title: result.title,
                        sources: result.sources,
                        sourceKey: source?.sourceKey ?? "",
                        videoId: source?.videoId ?? "",
                        coverHint: SearchView.bestCover(resultCover: result.cover, resultTitle: result.title,
                                                        query: viewModel.query, coverHint: coverHint),
                        resumeIntent: resumeIntent
                    )
                    onPlay?(dest)
                } label: {
                    VideoCard(
                        title: result.title,
                        cover: result.cover,
                        subtitle: DisplayFormatters.metaLine([result.type, result.year]),
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

#if os(iOS)
struct SearchContentView: View {
    @Bindable var viewModel: SearchViewModel
    @Binding var path: NavigationPath
    let appVM: AppViewModel
    @Binding var coverHint: String
    @Binding var resumeIntent: EpisodeResumeIntent?
    @Environment(\.appTheme) private var theme
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        VStack(spacing: 0) {
            searchField
                .padding(.horizontal, Spacing.page)
                .padding(.vertical, Spacing.sm)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if viewModel.isSearching {
                        if !viewModel.searchPhase.isEmpty {
                            searchProgressView
                        }
                        resultColumns { searchSkeleton }
                    } else if !viewModel.results.isEmpty {
                        resultColumns { searchResults }
                    } else if viewModel.hasSearched && !viewModel.isSearching {
                        emptyState
                    } else {
                        historySection
                    }
                }
                .padding(.bottom, Spacing.xl)
            }
            .scrollDismissesKeyboard(.immediately)
        }
    }

    private var searchField: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
            SearchTextField(
                text: $viewModel.query,
                placeholder: String(localized: "Search videos..."),
                onSubmit: {
                    coverHint = ""
                    resumeIntent = nil
                    Task { await viewModel.submitSearch() }
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
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Clear"))
            }
        }
        .padding(.horizontal, Spacing.md)
        .frame(minHeight: 44)
        .background(Surface.fill, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
    }

    /// Two columns of result rows on iPad, where a single row would leave most of the width empty;
    /// one column on phones.
    ///
    /// iPad 上以两栏显示结果行, 单栏会空出大部分宽度; 手机上为单栏.
    @ViewBuilder
    private func resultColumns(@ViewBuilder _ rows: () -> some View) -> some View {
        if sizeClass == .regular {
            let column = GridItem(.flexible(), spacing: 0, alignment: .top)
            LazyVGrid(columns: [column, column], spacing: 0) { rows() }
        } else {
            rows()
        }
    }

    private var searchResults: some View {
        // SearchResult.id can collide across rows that share title/provider but differ by year.
        // Use the namespaced row index so SwiftUI never reuses a result or skeleton incorrectly.
        //
        // 同标题和视频源但年份不同的结果可能产生相同 SearchResult.id. 使用带命名空间的
        // 行下标, 避免 SwiftUI 错误复用结果行或骨架行.
        ForEach(searchRows) { row in
            let result = row.result
            Button {
                let source = result.sources.first
                path.append(PlayDestination(
                    title: result.title,
                    sources: result.sources,
                    sourceKey: source?.sourceKey ?? "",
                    videoId: source?.videoId ?? "",
                    coverHint: SearchView.bestCover(resultCover: result.cover, resultTitle: result.title,
                                                    query: viewModel.query, coverHint: coverHint),
                    resumeIntent: resumeIntent
                ))
            } label: {
                searchResultRow(result)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.pressable)
            .accessibilityIdentifier("searchResult")
        }
    }

    private func searchResultRow(_ result: SearchResult) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            Color.clear
                .frame(width: 72, height: 108)
                .overlay { ArtworkImage(url: coverURL(result.cover), title: result.title, compactPlaceholder: true) }
                .artworkFrame(radius: Radius.sm)

            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(result.title)
                    .font(AppFont.bodyEmphasis)
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                let meta = DisplayFormatters.metaLine([result.type, result.year], separator: " · ")
                if !meta.isEmpty {
                    Text(meta)
                        .font(AppFont.secondary)
                        .foregroundStyle(.secondary)
                }
                if let desc = DisplayFormatters.bestDescription(title: result.title, desc: result.desc) {
                    Text(desc)
                        .font(AppFont.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                HStack(spacing: Spacing.sm) {
                    Label("\(result.sources.count) sources", systemImage: "server.rack")
                        .foregroundStyle(.secondary)
                    if let source = result.sources.first, source.durationMs > 0 {
                        Text(DisplayFormatters.latency(source.durationMs))
                            .monospacedDigit()
                            .foregroundStyle(theme.accent)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(theme.accentTint, in: Capsule())
                    }
                }
                .font(AppFont.meta)
                .padding(.top, Spacing.xxs)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, Spacing.page)
        .padding(.vertical, Spacing.md)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Surface.separator).frame(height: 0.5)
                .padding(.leading, Spacing.page + 72 + Spacing.md)
        }
    }

    private func coverURL(_ cover: String) -> URL? {
        guard !cover.isEmpty else { return nil }
        if cover.hasPrefix("/"), let client = appVM.apiClient {
            return URL(string: client.baseURL + cover)
        }
        return URL(string: cover)
    }

    private var searchSkeleton: some View {
        ForEach((0..<(sizeClass == .regular ? 8 : 4)).map(SearchRowIdentity.skeleton), id: \.self) { _ in
            HStack(alignment: .top, spacing: Spacing.md) {
                RoundedRectangle(cornerRadius: Radius.sm)
                    .skeleton(with: true, shape: .rounded(.radius(Radius.sm, style: .continuous)))
                    .frame(width: 72, height: 108)

                VStack(alignment: .leading, spacing: Spacing.sm) {
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
                .padding(.top, Spacing.xs)
                Spacer()
            }
            .padding(.horizontal, Spacing.page)
            .padding(.vertical, Spacing.md)
        }
    }

    private var searchRows: [SearchResultRow] {
        viewModel.results.enumerated().map { offset, result in
            SearchResultRow(id: .result(offset), result: result)
        }
    }

    private var searchProgressView: some View {
        HStack(spacing: Spacing.sm) {
            ProgressView()
                .controlSize(.small)
            Text(progressText)
                .font(AppFont.footnote)
                .monospacedDigit()
                .foregroundStyle(.secondary)
        }
        .accessibilityIdentifier("searchProgress")
        .frame(maxWidth: .infinity)
        .padding(.horizontal, Spacing.page)
        .padding(.vertical, Spacing.sm)
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
        ContentUnavailableView {
            Label("No results found", systemImage: "magnifyingglass")
        }
        .padding(.top, Spacing.xxl)
    }

    @ViewBuilder
    private var historySection: some View {
        if !viewModel.searchHistory.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.md) {
                SectionHeader(Text("Search History")) {
                    Button("Clear") { viewModel.clearHistory() }
                        .foregroundStyle(.secondary)
                }
                FlowLayout(spacing: Spacing.sm) {
                    ForEach(viewModel.searchHistory, id: \.query) { item in
                        Button(item.query) {
                            coverHint = ""
                            resumeIntent = nil
                            Task { await viewModel.submitSearch(query: item.query) }
                        }
                        .buttonStyle(.chip(selected: false, minHeight: 34, capsule: true))
                    }
                }
            }
            .padding(.horizontal, Spacing.page)
            .padding(.top, Spacing.sm)
        }
    }
}
#endif

private struct SearchResultRow: Identifiable {
    /// Namespaced identity avoids SwiftUI reusing skeleton rows for real results.
    ///
    /// 带命名空间的标识避免 SwiftUI 将骨架屏行复用为真实结果行.
    let id: SearchRowIdentity
    let result: SearchResult
}
