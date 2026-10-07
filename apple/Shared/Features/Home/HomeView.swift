import SwiftUI
import Kingfisher
import SkeletonUI

struct HomeView: View {
    @Environment(AppViewModel.self) private var appVM
    #if os(tvOS)
    var onSearch: ((SearchQuery) -> Void)?
    #else
    @Binding var path: NavigationPath
    #endif
    @State private var viewModel: HomeViewModel?
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var containerWidth: CGFloat = 0

    private var metrics: MediaMetrics { MediaMetrics(sizeClass) }

    private var heroHeight: CGFloat {
        metrics.heroHeight(width: containerWidth - Spacing.page * 2)
    }

    /// Width of the wide hero's text column: everything right of the poster.
    ///
    /// 宽 hero 文字栏的宽度: 海报右侧的全部空间.
    private var heroTextWidth: CGFloat {
        let heroWidth = containerWidth - Spacing.page * 2
        let posterWidth = (heroHeight - Spacing.xl * 2) * 2 / 3
        return max(240, heroWidth - Spacing.xl * 3 - posterWidth)
    }
    #endif

    /// Poster width in shelves.
    ///
    /// 横向列表中的海报宽度.
    private var cardWidth: CGFloat {
        #if os(tvOS)
        Theme.cardWidth
        #else
        metrics.cardWidth
        #endif
    }

    private var shelfSpacing: CGFloat {
        #if os(tvOS)
        12
        #else
        metrics.posterSpacing
        #endif
    }

    private func navigateToSearch(_ query: String) {
        navigateToSearch(SearchQuery(query: query))
    }

    private func navigateToSearch(_ searchQuery: SearchQuery) {
        #if os(tvOS)
        onSearch?(searchQuery)
        #else
        path.append(searchQuery)
        #endif
    }

    /// Gap between a section header and its shelf.
    ///
    /// 区块标题与其内容行之间的间距.
    private var headerGap: CGFloat {
        #if os(tvOS)
        40
        #else
        Spacing.md
        #endif
    }

    private var sectionSpacing: CGFloat {
        #if os(tvOS)
        40
        #else
        Spacing.section
        #endif
    }

    var body: some View {
        Group {
            if let viewModel {
                content(viewModel)
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
                let vm = HomeViewModel(apiClient: client, baseURL: client.baseURL, syncStore: appVM.sync?.store, syncEngine: appVM.sync?.engine)
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

    @ViewBuilder
    private func content(_ vm: HomeViewModel) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: sectionSpacing) {
                // Above the skeleton too, so the page does not shift when loading finishes.
                //
                // 骨架屏上方同样显示, 加载完成时页面不会跳动.
                #if os(iOS)
                topBar
                #endif
                if vm.isLoading {
                    skeletonContent
                } else {
                    #if os(iOS)
                    if let error = vm.error, vm.sections.isEmpty && vm.heroItems.isEmpty {
                        homeError(error)
                    }
                    #endif

                    if !vm.heroItems.isEmpty {
                        #if os(tvOS)
                        tvHeroCards(vm.heroItems)
                        #else
                        heroCarousel(vm.heroItems)
                        #endif
                    }

                    if !vm.watchHistory.isEmpty {
                        continueWatchingSection(vm)
                    }

                    ForEach(vm.sections) { section in
                        sectionRow(section)
                    }
                }
            }
        }
        #if os(iOS)
        .contentMargins(.bottom, Spacing.xl, for: .scrollContent)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { containerWidth = $0 }
        .background(Surface.canvas)
        .refreshable {
            await viewModel?.load()
        }
        #endif
    }

    #if os(iOS)
    @ViewBuilder
    private func homeError(_ message: String) -> some View {
        Text(message)
            .font(AppFont.secondary)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.page)
            .padding(.vertical, Spacing.xl)
    }
    #endif

    // MARK: - Top Bar (iOS only)

    #if os(iOS)
    private var topBar: some View {
        HStack(alignment: .center) {
            Text(verbatim: "KMTV")
                .font(AppFont.display)
                .foregroundStyle(.primary)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            Button {
                navigateToSearch("")
            } label: {
                Image(systemName: "magnifyingglass")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.primary)
                    .frame(width: 40, height: 40)
                    .background(Surface.fill, in: Circle())
            }
            .buttonStyle(.pressable)
            .accessibilityLabel(Text("Search"))
            .accessibilityIdentifier("homeSearchButton")
        }
        .padding(.horizontal, Spacing.page)
        .padding(.top, Spacing.sm)
    }
    #endif

    // MARK: - tvOS Hero Cards (horizontal scroll)

    #if os(tvOS)
    @ViewBuilder
    private func tvHeroCards(_ items: [DoubanItem]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: 24) {
                ForEach(items) { item in
                    Button {
                        navigateToSearch(SearchQuery(query: item.title, coverHint: item.cover))
                    } label: {
                        ZStack(alignment: .bottomLeading) {
                            Color(white: 0.08)

                            KFImage(heroImageURL(item.cover))
                                .placeholder {
                                    Rectangle().fill(Color(white: 0.15))
                                }
                                .fade(duration: 0.25)
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                                .frame(width: 880, height: Theme.heroHeight)
                                .clipped()

                            LinearGradient(
                                colors: [.clear, .black.opacity(0.6), .black],
                                startPoint: .top,
                                endPoint: .bottom
                            )

                            VStack(alignment: .leading, spacing: 8) {
                                Text(item.title)
                                    .font(.title2.bold())
                                if !item.year.isEmpty || !item.rate.isEmpty {
                                    HStack(spacing: 8) {
                                        if !item.year.isEmpty {
                                            Text(item.year)
                                        }
                                        if !item.rate.isEmpty, item.rate != "0" {
                                            Text("⭐ \(item.rate)")
                                        }
                                    }
                                    .font(.callout)
                                    .foregroundStyle(.secondary)
                                }
                            }
                            .padding(24)
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                    }
                    .buttonStyle(.tvHeroScale)
                }
            }
            .padding(.horizontal, 48)
            .padding(.vertical, 20)
        }
        .focusSection()
    }
    #endif

    // MARK: - iOS Hero Carousel

    #if os(iOS)
    private var heroIndexBinding: Binding<Int> {
        Binding(get: { viewModel?.heroIndex ?? 0}, set: { viewModel?.heroIndex = $0 })
    }

    @ViewBuilder
    private func heroCarousel(_ items: [DoubanItem]) -> some View {
        VStack(spacing: Spacing.sm + 2) {
            TabView(selection: heroIndexBinding) {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    heroSlide(item)
                        .padding(.horizontal, Spacing.page)
                        .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .frame(height: heroHeight)

            if items.count > 1 {
                HeroPageDots(count: items.count, current: viewModel?.heroIndex ?? 0)
            }
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                guard !Task.isCancelled else { break }
                guard let count = viewModel?.heroItems.count, count > 1 else { continue }
                withAnimation {
                    viewModel?.heroIndex = ((viewModel?.heroIndex ?? 0) + 1) % count
                }
            }
        }
    }

    @ViewBuilder
    private func heroSlide(_ item: DoubanItem) -> some View {
        Button {
            navigateToSearch(SearchQuery(query: item.title, coverHint: item.cover))
        } label: {
            if metrics.regular {
                wideHeroSlide(item)
            } else {
                phoneHeroSlide(item)
            }
        }
        .buttonStyle(.pressable)
    }

    /// The phone hero: the cover fills the card under a bottom scrim.
    ///
    /// 手机 hero: 封面铺满卡片, 底部叠加遮罩.
    private func phoneHeroSlide(_ item: DoubanItem) -> some View {
        Color.clear
            .overlay { ArtworkImage(url: heroImageURL(item.cover), title: item.title) }
            .overlay {
                LinearGradient(colors: [.clear, .black.opacity(0.72)], startPoint: .center, endPoint: .bottom)
            }
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(item.title)
                        .font(AppFont.title)
                        .lineLimit(1)
                    heroMeta(item)
                        .font(AppFont.secondary)
                        .foregroundStyle(.white.opacity(0.82))
                }
                .foregroundStyle(.white)
                .padding(Spacing.lg)
            }
            .artworkFrame(radius: Radius.lg)
    }

    /// The iPad hero: covers are portrait, so a wide card shows the sharp poster on a blurred copy
    /// of itself instead of stretching it across the width.
    ///
    /// iPad hero: 封面是竖版的, 因此宽卡片在封面自身的模糊背景上显示清晰海报, 而不是把它拉满整个宽度.
    private func wideHeroSlide(_ item: DoubanItem) -> some View {
        let posterHeight = heroHeight - Spacing.xl * 2
        let desc = item.desc?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        // Centered beside the poster when a synopsis fills the column; on the poster's baseline otherwise.
        //
        // 有简介时文字栏在海报旁垂直居中; 否则与海报底部对齐.
        return HStack(alignment: desc.isEmpty ? .bottom : .center, spacing: Spacing.xl) {
            Color.clear
                .frame(width: posterHeight * 2 / 3, height: posterHeight)
                .overlay { ArtworkImage(url: heroImageURL(item.cover), title: item.title) }
                .artworkFrame()
                .shadow(color: .black.opacity(0.4), radius: 14, y: 6)
            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text(item.title)
                    .font(AppFont.display)
                    .lineLimit(2)
                    .frame(maxWidth: heroTextWidth, alignment: .leading)
                heroMeta(item)
                    .font(AppFont.body)
                    .foregroundStyle(.white.opacity(0.82))
                if !desc.isEmpty {
                    Text(desc)
                        .font(AppFont.body)
                        .foregroundStyle(.white.opacity(0.78))
                        .lineSpacing(4)
                        .lineLimit(4)
                        .frame(maxWidth: heroTextWidth, alignment: .leading)
                        .padding(.top, Spacing.xs)
                }
            }
            .foregroundStyle(.white)
            .padding(.bottom, desc.isEmpty ? Spacing.xs : 0)
            Spacer(minLength: 0)
        }
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background {
            ZStack {
                Color.black
                ArtworkImage(url: heroImageURL(item.cover), title: item.title, showsPlaceholder: false)
                    .blur(radius: 36, opaque: true)
                    .opacity(0.85)
                LinearGradient(colors: [.black.opacity(0.55), .black.opacity(0.1)], startPoint: .leading, endPoint: .trailing)
            }
        }
        .artworkFrame(radius: Radius.lg)
    }

    private func heroMeta(_ item: DoubanItem) -> some View {
        HStack(spacing: Spacing.xs + 2) {
            if !item.year.isEmpty {
                Text(item.year)
            }
            if let rating = RatingBadge.text(for: item.rate) {
                Label(rating, systemImage: "star.fill")
                    .labelStyle(.titleAndIcon)
                    .monospacedDigit()
            }
        }
        .imageScale(.small)
    }
    #endif

    private func heroImageURL(_ cover: String) -> URL? {
        guard !cover.isEmpty else { return nil }
        if cover.hasPrefix("/"), let client = appVM.apiClient {
            return URL(string: client.baseURL + cover)
        }
        return URL(string: cover)
    }

    // MARK: - Continue Watching

    @ViewBuilder
    private func continueWatchingSection(_ vm: HomeViewModel) -> some View {
        VStack(alignment: .leading, spacing: headerGap) {
            #if os(tvOS)
            HStack {
                Text("Continue Watching")
                    .font(.headline)
                    .foregroundStyle(.primary)
                Spacer()
            }
            .padding(.horizontal, 48)
            #else
            SectionHeader(Text("Continue Watching")) {
                Button("Clear") { vm.clearWatchHistory() }
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, Spacing.page)
            #endif

            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: shelfSpacing) {
                    ForEach(vm.watchHistory) { item in
                        Button {
                            navigateToSearch(SearchQuery(
                                query: item.title,
                                coverHint: continueCoverHint(item),
                                resumeIntent: EpisodeResumeIntent(
                                    episodeIndex: item.episodeIndex,
                                    episodeName: item.episode
                                )
                            ))
                        } label: {
                            watchHistoryCard(item)
                        }
                        #if os(tvOS)
                        .buttonStyle(.tvScale)
                        #else
                        .buttonStyle(.pressable)
                        #endif
                        .accessibilityIdentifier("continueWatchingCard")
                    }
                }
                #if os(tvOS)
                .padding(.horizontal, 48)
                .padding(.vertical, 20)
                #else
                .padding(.horizontal, Spacing.page)
                #endif
            }
            #if os(tvOS)
            .focusSection()
            .scrollClipDisabled()
            #endif
        }
    }

    private func watchHistoryCard(_ item: WatchPayload) -> some View {
        #if os(tvOS)
        ZStack(alignment: .bottomLeading) {
            KFImage(heroImageURL(item.cover))
                .placeholder {
                    RoundedRectangle(cornerRadius: 12).fill(Theme.bgCard)
                }
                .fade(duration: 0.25)
                .resizable()
                .aspectRatio(2/3, contentMode: .fill)
                .frame(width: Theme.cardWidth, height: Theme.cardWidth * 1.5)
                .clipShape(RoundedRectangle(cornerRadius: 12))

            LinearGradient(
                colors: [.clear, .black.opacity(0.75)],
                startPoint: .center,
                endPoint: .bottom
            )
            .frame(width: Theme.cardWidth, height: Theme.cardWidth * 1.5)
            .clipShape(RoundedRectangle(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 4) {
                if item.durationSec > 0 {
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 1)
                            .fill(Color(white: 0.3))
                            .frame(height: 3)
                        RoundedRectangle(cornerRadius: 1)
                            .fill(Theme.accent)
                            .frame(width: (Theme.cardWidth - 20) * min(1.0, CGFloat(item.progressSec / item.durationSec)), height: 3)
                    }
                    .frame(width: Theme.cardWidth - 20, height: 3)
                }
                Text(item.title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
            }
            .padding(10)
        }
        .frame(width: Theme.cardWidth, height: Theme.cardWidth * 1.5)
        #else
        VideoCard(
            title: item.title,
            cover: item.cover,
            subtitle: continueSubtitle(item),
            apiClient: appVM.apiClient,
            progress: item.durationSec > 0 ? item.progressSec / item.durationSec : nil
        )
        .frame(width: cardWidth)
        #endif
    }

    /// The cover hint for a history card: the registered Douban cover when one is known, since a
    /// record saved from a source may keep a cover its host refuses to serve.
    ///
    /// 历史卡片的封面提示: 已登记豆瓣封面时优先使用它, 因为从源站保存的记录可能沿用其图片服务器拒绝
    /// 提供的封面.
    private func continueCoverHint(_ item: WatchPayload) -> String {
        #if os(iOS)
        CoverRegistry.rawCover(for: item.title) ?? item.cover
        #else
        item.cover
        #endif
    }

    #if os(iOS)
    /// "Episode 3 · 38 min left", or the episode alone when the duration is unknown.
    ///
    /// "第 3 集 · 剩 38 分钟"; 时长未知时只显示剧集名.
    private func continueSubtitle(_ item: WatchPayload) -> String? {
        let remaining = Int(((item.durationSec - item.progressSec) / 60).rounded(.up))
        let left = item.durationSec > 0 && remaining > 0 ? String(localized: "\(remaining) min left") : nil
        let parts = [item.episode.isEmpty ? nil : item.episode, left].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
    #endif

    // MARK: - Section Rows

    @ViewBuilder
    private func sectionRow(_ section: HomeSection) -> some View {
        VStack(alignment: .leading, spacing: headerGap) {
            #if os(tvOS)
            HStack {
                Text(section.name)
                    .font(.headline)
                    .foregroundStyle(.primary)
                Spacer()
            }
            .padding(.horizontal, 48)
            #else
            SectionHeader(Text(section.name))
                .padding(.horizontal, Spacing.page)
            #endif

            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: shelfSpacing) {
                    ForEach(section.items) { item in
                        Button {
                            navigateToSearch(SearchQuery(query: item.title, coverHint: item.cover))
                        } label: {
                            VideoCard(
                                title: item.title,
                                cover: item.cover,
                                subtitle: item.year,
                                rating: item.rate,
                                apiClient: appVM.apiClient
                            )
                            .frame(width: cardWidth)
                        }
                        #if os(tvOS)
                        .buttonStyle(.tvScale)
                        #else
                        .buttonStyle(.pressable)
                        #endif
                    }
                }
                #if os(tvOS)
                .padding(.horizontal, 48)
                .padding(.vertical, 20)
                #else
                .padding(.horizontal, Spacing.page)
                #endif
            }
            #if os(tvOS)
            .focusSection()
            .scrollClipDisabled()
            #endif
        }
    }

    // MARK: - Skeleton Loading

    #if os(tvOS)
    private var skeletonContent: some View {
        VStack(alignment: .leading, spacing: 24) {
            RoundedRectangle(cornerRadius: 0)
                .skeleton(with: true, shape: .rectangle)
                .frame(height: Theme.heroHeight)

            ForEach(0..<2, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 4)
                    .skeleton(with: true, shape: .rounded(.radius(4, style: .continuous)))
                    .frame(width: 120, height: 20)
                    .padding(.horizontal)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(0..<4, id: \.self) { _ in
                            VStack(alignment: .leading, spacing: 4) {
                                RoundedRectangle(cornerRadius: 8)
                                    .skeleton(with: true, shape: .rounded(.radius(8, style: .continuous)))
                                    .frame(width: Theme.cardWidth, height: Theme.cardWidth * 1.5)
                                RoundedRectangle(cornerRadius: 3)
                                    .skeleton(with: true, shape: .rounded(.radius(3, style: .continuous)))
                                    .frame(width: Theme.cardWidth * 0.7, height: 12)
                            }
                        }
                    }
                    .padding(.horizontal)
                }
            }
        }
    }
    #else
    /// Mirrors the loaded page: same hero height (with room for the page dots), poster width, and
    /// spacing, and enough cards to fill a landscape iPad shelf.
    ///
    /// 与加载完成后的页面一致: 相同的 hero 高度 (含分页圆点的位置), 海报宽度与间距, 卡片数量足以填满
    /// 横屏 iPad 的整行.
    private var skeletonContent: some View {
        VStack(alignment: .leading, spacing: sectionSpacing) {
            RoundedRectangle(cornerRadius: Radius.lg)
                .skeleton(with: true, shape: .rounded(.radius(Radius.lg, style: .continuous)))
                .frame(height: heroHeight)
                .padding(.horizontal, Spacing.page)
                .padding(.bottom, Spacing.sm + 2 + 6)

            ForEach(0..<2, id: \.self) { _ in
                VStack(alignment: .leading, spacing: headerGap) {
                    RoundedRectangle(cornerRadius: 4)
                        .skeleton(with: true, shape: .rounded(.radius(4, style: .continuous)))
                        .frame(width: 120, height: 20)
                        .padding(.horizontal, Spacing.page)

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: shelfSpacing) {
                            ForEach(0..<(metrics.regular ? 9 : 4), id: \.self) { _ in
                                VStack(alignment: .leading, spacing: 6) {
                                    RoundedRectangle(cornerRadius: Radius.md)
                                        .skeleton(with: true, shape: .rounded(.radius(Radius.md, style: .continuous)))
                                        .frame(width: cardWidth, height: cardWidth * 1.5)
                                    RoundedRectangle(cornerRadius: 3)
                                        .skeleton(with: true, shape: .rounded(.radius(3, style: .continuous)))
                                        .frame(width: cardWidth * 0.7, height: 12)
                                }
                            }
                        }
                        .padding(.horizontal, Spacing.page)
                    }
                    .scrollDisabled(true)
                }
            }
        }
    }
    #endif
}

#if os(iOS)
/// Page dots under the home hero; the current page stretches into a short accent bar.
///
/// 首页 hero 下方的分页圆点; 当前页拉伸为一段强调色短条.
private struct HeroPageDots: View {
    let count: Int
    let current: Int
    @Environment(\.appTheme) private var theme

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<count, id: \.self) { index in
                Capsule()
                    .fill(index == current ? theme.accent : Color(uiColor: .tertiaryLabel))
                    .frame(width: index == current ? 18 : 6, height: 6)
            }
        }
        .animation(.easeOut(duration: 0.25), value: current)
        .accessibilityHidden(true)
    }
}
#endif
