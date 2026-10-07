#if os(tvOS)
import SwiftUI
import Kingfisher
import SkeletonUI

/// The tvOS home page: a row of wide hero cards, Continue Watching, and the Douban shelves, each a
/// focus section, with a skeleton while loading.
///
/// tvOS 首页: 一排宽 hero 卡片, 继续观看, 以及豆瓣横向列表, 每一行都是一个焦点区域; 加载时显示骨架屏.
struct TVHomeContentView: View {
    let vm: HomeViewModel
    /// The server base URL that server-relative covers resolve against.
    ///
    /// 服务端相对封面路径所基于的服务器地址.
    let baseURL: String?
    let onSearch: (SearchQuery) -> Void

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: TVSpacing.section) {
                if vm.isLoading {
                    skeletonContent
                } else {
                    if !vm.heroItems.isEmpty {
                        heroCards(vm.heroItems)
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
    }

    // MARK: - Hero Cards

    private func heroCards(_ items: [DoubanItem]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: TVSpacing.hero) {
                ForEach(items) { item in
                    Button {
                        onSearch(SearchQuery(query: item.title, coverHint: item.cover))
                    } label: {
                        heroCard(item)
                    }
                    .buttonStyle(.tvHeroScale)
                }
            }
            .padding(.horizontal, TVSpacing.page)
            .padding(.vertical, TVSpacing.focusRoom)
        }
        .focusSection()
    }

    private func heroCard(_ item: DoubanItem) -> some View {
        ZStack(alignment: .bottomLeading) {
            TVSurface.heroBase

            KFImage(coverURL(item.cover))
                .placeholder {
                    Rectangle().fill(TVSurface.control)
                }
                .fade(duration: 0.25)
                .resizable()
                .aspectRatio(contentMode: .fill)
                .frame(width: TVMetrics.heroWidth, height: TVMetrics.heroHeight)
                .clipped()

            LinearGradient(
                colors: [.clear, .black.opacity(0.6), .black],
                startPoint: .top,
                endPoint: .bottom
            )

            VStack(alignment: .leading, spacing: TVSpacing.sm) {
                Text(item.title)
                    .font(.title2.bold())
                let rating = RatingBadge.text(for: item.rate)
                if !item.year.isEmpty || rating != nil {
                    HStack(spacing: TVSpacing.sm) {
                        if !item.year.isEmpty {
                            Text(item.year)
                        }
                        if let rating {
                            Text("⭐ \(rating)")
                        }
                    }
                    .font(.callout)
                    .foregroundStyle(.secondary)
                }
            }
            .padding(TVSpacing.hero)
        }
        .clipShape(RoundedRectangle(cornerRadius: TVRadius.hero))
    }

    private func coverURL(_ cover: String) -> URL? {
        resolveAssetURL(cover, baseURL: baseURL)
    }

    // MARK: - Shelves

    private var continueWatchingSection: some View {
        VStack(alignment: .leading, spacing: TVSpacing.section) {
            shelfHeader(Text("Continue Watching"))

            shelf {
                ForEach(vm.watchHistory) { item in
                    Button {
                        onSearch(SearchQuery(
                            query: item.title,
                            coverHint: item.cover,
                            resumeIntent: EpisodeResumeIntent(
                                episodeIndex: item.episodeIndex,
                                episodeName: item.episode
                            )
                        ))
                    } label: {
                        watchHistoryCard(item)
                    }
                    .buttonStyle(.tvScale)
                    .accessibilityIdentifier("continueWatchingCard")
                }
            }
        }
    }

    private func watchHistoryCard(_ item: WatchPayload) -> some View {
        let width = TVMetrics.cardWidth
        let barWidth = width - TVSpacing.caption * 2
        return ZStack(alignment: .bottomLeading) {
            KFImage(coverURL(item.cover))
                .placeholder {
                    RoundedRectangle(cornerRadius: TVRadius.card).fill(Theme.bgCard)
                }
                .fade(duration: 0.25)
                .resizable()
                .aspectRatio(2/3, contentMode: .fill)
                .frame(width: width, height: width * 1.5)
                .clipShape(RoundedRectangle(cornerRadius: TVRadius.card))

            LinearGradient(
                colors: [.clear, .black.opacity(0.75)],
                startPoint: .center,
                endPoint: .bottom
            )
            .frame(width: width, height: width * 1.5)
            .clipShape(RoundedRectangle(cornerRadius: TVRadius.card))

            VStack(alignment: .leading, spacing: TVSpacing.xs) {
                if item.durationSec > 0 {
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 1)
                            .fill(Color(white: 0.3))
                            .frame(height: 3)
                        RoundedRectangle(cornerRadius: 1)
                            .fill(Theme.accent)
                            .frame(width: barWidth * min(1.0, CGFloat(item.progressSec / item.durationSec)), height: 3)
                    }
                    .frame(width: barWidth, height: 3)
                }
                Text(item.title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
            }
            .padding(TVSpacing.caption)
        }
        .frame(width: width, height: width * 1.5)
    }

    private func sectionRow(_ section: HomeSection) -> some View {
        VStack(alignment: .leading, spacing: TVSpacing.section) {
            shelfHeader(Text(section.name))

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
                        .frame(width: TVMetrics.cardWidth)
                    }
                    .buttonStyle(.tvScale)
                }
            }
        }
    }

    private func shelfHeader(_ title: Text) -> some View {
        HStack {
            title
                .font(.headline)
                .foregroundStyle(.primary)
            Spacer()
        }
        .padding(.horizontal, TVSpacing.page)
    }

    /// A horizontal shelf of cards: its own focus section, with room above and below so focused
    /// cards can scale past its bounds.
    ///
    /// 横向卡片列表: 自成一个焦点区域, 上下留有空间, 使获得焦点的卡片放大后可超出其边界.
    private func shelf<Cards: View>(@ViewBuilder _ cards: () -> Cards) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: TVSpacing.shelf) {
                cards()
            }
            .padding(.horizontal, TVSpacing.page)
            .padding(.vertical, TVSpacing.focusRoom)
        }
        .focusSection()
        .scrollClipDisabled()
    }

    // MARK: - Skeleton Loading

    private var skeletonContent: some View {
        VStack(alignment: .leading, spacing: TVSpacing.hero) {
            RoundedRectangle(cornerRadius: 0)
                .skeleton(with: true, shape: .rectangle)
                .frame(height: TVMetrics.heroHeight)

            ForEach(0..<2, id: \.self) { _ in
                RoundedRectangle(cornerRadius: TVRadius.badge)
                    .skeleton(with: true, shape: .rounded(.radius(TVRadius.badge, style: .continuous)))
                    .frame(width: 120, height: 20)
                    .padding(.horizontal)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: TVSpacing.shelf) {
                        ForEach(0..<4, id: \.self) { _ in
                            PosterSkeleton(width: TVMetrics.cardWidth)
                        }
                    }
                    .padding(.horizontal)
                }
            }
        }
    }
}
#endif
