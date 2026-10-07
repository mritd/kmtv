#if os(iOS)
import SwiftUI
import SkeletonUI

/// The iOS home page: the top bar, the hero carousel (a full-bleed cover on phones, a poster beside
/// its synopsis on iPad), Continue Watching, and the Douban shelves, with a matching skeleton while
/// loading.
///
/// iOS 首页: 顶部栏, hero 轮播 (手机上封面铺满, iPad 上海报与简介并排), 继续观看, 以及豆瓣横向列表;
/// 加载时显示与之对应的骨架屏.
struct HomeContentView: View {
    let vm: HomeViewModel
    /// The server base URL that server-relative covers resolve against.
    ///
    /// 服务端相对封面路径所基于的服务器地址.
    let baseURL: String?
    /// Supplies the registered cover hint of history cards.
    ///
    /// 为历史卡片提供已登记的封面提示.
    let covers: CoverRegistry?
    let onSearch: (SearchQuery) -> Void

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

    /// Poster width in shelves.
    ///
    /// 横向列表中的海报宽度.
    private var cardWidth: CGFloat { metrics.cardWidth }

    private var shelfSpacing: CGFloat { metrics.posterSpacing }

    /// Gap between a section header and its shelf.
    ///
    /// 区块标题与其内容行之间的间距.
    private var headerGap: CGFloat { Spacing.md }

    private var sectionSpacing: CGFloat { Spacing.section }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: sectionSpacing) {
                // Above the skeleton too, so the page does not shift when loading finishes.
                //
                // 骨架屏上方同样显示, 加载完成时页面不会跳动.
                topBar
                if vm.isLoading {
                    skeletonContent
                } else {
                    if let error = vm.error, vm.sections.isEmpty && vm.heroItems.isEmpty {
                        homeError(error)
                    }

                    if !vm.heroItems.isEmpty {
                        heroCarousel(vm.heroItems)
                    }

                    if !vm.watchHistory.isEmpty {
                        continueWatchingSection
                    }

                    ForEach(vm.sections) { section in
                        sectionRow(section)
                    }
                }
            }
        }
        .contentMargins(.bottom, Spacing.xl, for: .scrollContent)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { containerWidth = $0 }
        .background(Surface.canvas)
        .refreshable {
            await vm.load()
        }
    }

    private func homeError(_ message: String) -> some View {
        Text(message)
            .font(AppFont.secondary)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.page)
            .padding(.vertical, Spacing.xl)
    }

    // MARK: - Top Bar

    private var topBar: some View {
        HStack(alignment: .center) {
            Text(verbatim: "KMTV")
                .font(AppFont.display)
                .foregroundStyle(.primary)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            Button {
                onSearch(SearchQuery(query: ""))
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

    // MARK: - Hero Carousel

    private var heroIndexBinding: Binding<Int> {
        Binding(get: { vm.heroIndex }, set: { vm.heroIndex = $0 })
    }

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
                HeroPageDots(count: items.count, current: vm.heroIndex)
            }
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                guard !Task.isCancelled else { break }
                let count = vm.heroItems.count
                guard count > 1 else { continue }
                withAnimation {
                    vm.heroIndex = (vm.heroIndex + 1) % count
                }
            }
        }
    }

    private func heroSlide(_ item: DoubanItem) -> some View {
        Button {
            onSearch(SearchQuery(query: item.title, coverHint: item.cover))
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
            .overlay { ArtworkImage(url: coverURL(item.cover), title: item.title) }
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
                .overlay { ArtworkImage(url: coverURL(item.cover), title: item.title) }
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
                ArtworkImage(url: coverURL(item.cover), title: item.title, showsPlaceholder: false)
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

    private func coverURL(_ cover: String) -> URL? {
        resolveAssetURL(cover, baseURL: baseURL)
    }

    // MARK: - Shelves

    private var continueWatchingSection: some View {
        VStack(alignment: .leading, spacing: headerGap) {
            SectionHeader(Text("Continue Watching")) {
                Button("Clear") { vm.clearWatchHistory() }
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, Spacing.page)

            shelf {
                ForEach(vm.watchHistory) { item in
                    Button {
                        onSearch(SearchQuery(
                            query: item.title,
                            coverHint: continueCoverHint(item),
                            resumeIntent: EpisodeResumeIntent(
                                episodeIndex: item.episodeIndex,
                                episodeName: item.episode
                            )
                        ))
                    } label: {
                        VideoCard(
                            title: item.title,
                            cover: item.cover,
                            subtitle: continueSubtitle(item),
                            baseURL: baseURL,
                            progress: item.durationSec > 0 ? item.progressSec / item.durationSec : nil
                        )
                        .frame(width: cardWidth)
                    }
                    .buttonStyle(.pressable)
                    .accessibilityIdentifier("continueWatchingCard")
                }
            }
        }
    }

    /// The cover hint for a history card: the registered Douban cover when one is known, since a
    /// record saved from a source may keep a cover its host refuses to serve.
    ///
    /// 历史卡片的封面提示: 已登记豆瓣封面时优先使用它, 因为从源站保存的记录可能沿用其图片服务器拒绝
    /// 提供的封面.
    private func continueCoverHint(_ item: WatchPayload) -> String {
        covers?.rawCover(for: item.title) ?? item.cover
    }

    /// "Episode 3 · 38 min left", or the episode alone when the duration is unknown.
    ///
    /// "第 3 集 · 剩 38 分钟"; 时长未知时只显示剧集名.
    private func continueSubtitle(_ item: WatchPayload) -> String? {
        let remaining = Int(((item.durationSec - item.progressSec) / 60).rounded(.up))
        let left = item.durationSec > 0 && remaining > 0 ? String(localized: "\(remaining) min left") : nil
        let parts = [item.episode.isEmpty ? nil : item.episode, left].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func sectionRow(_ section: HomeSection) -> some View {
        VStack(alignment: .leading, spacing: headerGap) {
            SectionHeader(Text(section.name))
                .padding(.horizontal, Spacing.page)

            shelf {
                ForEach(section.items) { item in
                    Button {
                        onSearch(SearchQuery(query: item.title, coverHint: item.cover))
                    } label: {
                        VideoCard(
                            title: item.title,
                            cover: item.cover,
                            subtitle: item.year,
                            rating: item.rate,
                            baseURL: baseURL
                        )
                        .frame(width: cardWidth)
                    }
                    .buttonStyle(.pressable)
                }
            }
        }
    }

    /// A horizontal shelf of cards inside the page margins.
    ///
    /// 位于页面边距内的横向卡片列表.
    private func shelf<Cards: View>(@ViewBuilder _ cards: () -> Cards) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: shelfSpacing) {
                cards()
            }
            .padding(.horizontal, Spacing.page)
        }
    }

    // MARK: - Skeleton Loading

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
                    RoundedRectangle(cornerRadius: Radius.xs)
                        .skeleton(with: true, shape: .rounded(.radius(Radius.xs, style: .continuous)))
                        .frame(width: 120, height: 20)
                        .padding(.horizontal, Spacing.page)

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: shelfSpacing) {
                            ForEach(0..<(metrics.regular ? 9 : 4), id: \.self) { _ in
                                PosterSkeleton(width: cardWidth)
                            }
                        }
                        .padding(.horizontal, Spacing.page)
                    }
                    .scrollDisabled(true)
                }
            }
        }
    }
}

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
