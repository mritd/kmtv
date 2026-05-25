import SwiftUI
import Kingfisher
import SkeletonUI

struct HomeView: View {
    @Environment(AppViewModel.self) private var appVM
    @Environment(\.modelContext) private var modelContext
    #if os(tvOS)
    var onSearch: ((SearchQuery) -> Void)?
    #else
    @Binding var path: NavigationPath
    #endif
    @State private var viewModel: HomeViewModel?
    @State private var currentHeroIndex = 0

    private func navigateToSearch(_ query: String) {
        #if os(tvOS)
        onSearch?(SearchQuery(query: query))
        #else
        path.append(SearchQuery(query: query))
        #endif
    }

    private var sectionSpacing: CGFloat {
        #if os(tvOS)
        40
        #else
        24
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
        .background(Theme.bgPrimary)
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
                let vm = HomeViewModel(apiClient: client, modelContext: modelContext, serverURL: appVM.serverURL)
                viewModel = vm
                await vm.load()
            }
        }
        .onAppear {
            viewModel?.loadWatchHistory()
        }
    }

    @ViewBuilder
    private func content(_ vm: HomeViewModel) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: sectionSpacing) {
                if vm.isLoading {
                    skeletonContent
                } else {
                    #if os(iOS)
                    topBar
                    #endif

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
        .background(Theme.bgPrimary)
        .refreshable {
            await viewModel?.load()
        }
        #endif
    }

    #if os(iOS)
    @ViewBuilder
    private func homeError(_ message: String) -> some View {
        Text(message)
            .font(.callout.weight(.medium))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 48)
            .padding(.vertical, 24)
    }
    #endif

    // MARK: - Top Bar (iOS only)

    #if os(iOS)
    private var topBar: some View {
        HStack {
            Text("KMTV")
                .font(.title.bold())
                .foregroundStyle(Theme.textPrimary)
            Spacer()
            Button {
                navigateToSearch("")
            } label: {
                Image(systemName: "magnifyingglass")
                    .font(.title3)
                    .foregroundStyle(Theme.textPrimary)
                    .padding(8)
                    .background(Theme.textPrimary.opacity(0.1))
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("homeSearchButton")
        }
        .padding(.horizontal)
        .padding(.top, 8)
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
                        navigateToSearch(item.title)
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
    @ViewBuilder
    private func heroCarousel(_ items: [DoubanItem]) -> some View {
        TabView(selection: $currentHeroIndex) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                heroSlide(item)
                    .tag(index)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .always))
        .frame(height: Theme.heroHeight)
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                guard !Task.isCancelled else { break }
                guard let count = viewModel?.heroItems.count, count > 1 else { continue }
                withAnimation {
                    currentHeroIndex = (currentHeroIndex + 1) % count
                }
            }
        }
    }

    @ViewBuilder
    private func heroSlide(_ item: DoubanItem) -> some View {
        Button {
            navigateToSearch(item.title)
        } label: {
            ZStack(alignment: .bottomLeading) {
                KFImage(heroImageURL(item.cover))
                    .placeholder {
                        Rectangle().fill(Theme.bgSecondary)
                    }
                    .fade(duration: 0.25)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(height: Theme.heroHeight)
                    .clipped()

                LinearGradient(
                    colors: [.clear, Theme.bgPrimary.opacity(0.6), Theme.bgPrimary],
                    startPoint: .top,
                    endPoint: .bottom
                )

                VStack(alignment: .leading, spacing: 8) {
                    Text(item.title)
                        .font(.title2.bold())
                        .foregroundStyle(Theme.textPrimary)
                    if !item.year.isEmpty || !item.rate.isEmpty {
                        HStack(spacing: 8) {
                            if !item.year.isEmpty {
                                Text(item.year)
                            }
                            if !item.rate.isEmpty, item.rate != "0" {
                                Text("⭐ \(item.rate)")
                            }
                        }
                        .font(.caption)
                        .foregroundStyle(Theme.textSecondary)
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 16)
            }
        }
        .buttonStyle(.plain)
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
        HStack {
            Text("Continue Watching")
                .font(.headline)
                .foregroundStyle(.primary)
            Spacer()
            #if os(iOS)
            Button("Clear") { vm.clearWatchHistory() }
                .font(.caption)
                .foregroundStyle(.secondary)
            #endif
        }
        #if os(tvOS)
        .padding(.horizontal, 48)
        #else
        .padding(.horizontal)
        #endif

        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: 12) {
                ForEach(vm.watchHistory, id: \.persistentModelID) { item in
                    Button {
                        navigateToSearch(item.title)
                    } label: {
                        watchHistoryCard(item)
                    }
                    #if os(tvOS)
                    .buttonStyle(.tvScale)
                    #else
                    .buttonStyle(.plain)
                    #endif
                    .accessibilityIdentifier("continueWatchingCard")
                }
            }
            #if os(tvOS)
            .padding(.horizontal, 48)
            .padding(.vertical, 20)
            #else
            .padding(.horizontal)
            #endif
        }
        #if os(tvOS)
        .focusSection()
        .scrollClipDisabled()
        #endif
    }

    private func watchHistoryCard(_ item: WatchHistoryItem) -> some View {
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
                if item.duration > 0 {
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 1)
                            .fill(Color(white: 0.3))
                            .frame(height: 3)
                        RoundedRectangle(cornerRadius: 1)
                            .fill(Theme.accent)
                            .frame(width: (Theme.cardWidth - 20) * min(1.0, CGFloat(item.progress / item.duration)), height: 3)
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
        VStack(alignment: .leading, spacing: 4) {
            KFImage(heroImageURL(item.cover))
                .placeholder {
                    RoundedRectangle(cornerRadius: 6).fill(Theme.bgCard)
                }
                .fade(duration: 0.25)
                .resizable()
                .aspectRatio(2/3, contentMode: .fill)
                .frame(width: Theme.cardWidth, height: Theme.cardWidth * 1.5)
                .clipShape(RoundedRectangle(cornerRadius: 8))

            if item.duration > 0 {
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 1)
                        .fill(Theme.bgCard)
                        .frame(height: 3)
                    RoundedRectangle(cornerRadius: 1)
                        .fill(Theme.accent)
                        .frame(width: Theme.cardWidth * min(1.0, CGFloat(item.progress / item.duration)), height: 3)
                }
                .frame(width: Theme.cardWidth, height: 3)
            }

            Text(item.title)
                .font(.caption)
                .foregroundStyle(.primary)
                .lineLimit(1)
                .frame(width: Theme.cardWidth, alignment: .leading)
        }
        #endif
    }

    // MARK: - Section Rows

    @ViewBuilder
    private func sectionRow(_ section: HomeSection) -> some View {
        HStack {
            Text(section.name)
                .font(.headline)
                .foregroundStyle(.primary)
            Spacer()
        }
        #if os(tvOS)
        .padding(.horizontal, 48)
        #else
        .padding(.horizontal)
        #endif

        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: 12) {
                ForEach(section.items) { item in
                    Button {
                        navigateToSearch(item.title)
                    } label: {
                        VideoCard(
                            title: item.title,
                            cover: item.cover,
                            subtitle: item.year,
                            rating: item.rate,
                            apiClient: appVM.apiClient
                        )
                        .frame(width: Theme.cardWidth)
                    }
                    #if os(tvOS)
                    .buttonStyle(.tvScale)
                    #else
                    .buttonStyle(.plain)
                    #endif
                }
            }
            #if os(tvOS)
            .padding(.horizontal, 48)
            .padding(.vertical, 20)
            #else
            .padding(.horizontal)
            #endif
        }
        #if os(tvOS)
        .focusSection()
        .scrollClipDisabled()
        #endif
    }

    // MARK: - Skeleton Loading

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
}
