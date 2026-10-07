#if os(iOS)
import SwiftUI
import AVKit

/// The online player page: the inline video with its controls, then the header, episodes, and
/// playback settings, stacked or (landscape iPad) with a sidebar. The page lays the sections out and
/// runs the lifecycle; each section is its own view that reads only the state it shows, so a tap on
/// the video or a playback tick never re-evaluates this body or the other sections.
///
/// 在线播放页: 内嵌视频及其控制层, 下方依次为标题区, 剧集与播放设置, 或在横屏 iPad 上放入侧栏. 页面只负责
/// 布局与生命周期; 每个区域都是只读取自身所需状态的独立视图, 因此点按视频或播放进度更新不会让本 body 或
/// 其他区域重新求值.
struct PlayerView: View {
    let destination: PlayDestination

    @Environment(AppViewModel.self) private var appVM
    /// The download library; optional so a page built without it (a preview) still renders.
    ///
    /// 下载库; 设为可选, 使未提供它的页面 (例如预览) 也能渲染.
    @Environment(DownloadManager.self) private var downloadManager: DownloadManager?
    @Environment(\.modelContext) private var modelContext
    @Environment(\.scenePhase) private var scenePhase
    @State private var viewModel: PlayerViewModel?
    @State private var isFullScreen = false
    @State private var showPicker = false
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var contentWidth: CGFloat = 0

    var body: some View {
        Group {
            if let viewModel {
                content(viewModel)
            } else {
                ProgressView()
            }
        }
        .background(Surface.canvas)
        .navigationBarTitleDisplayMode(.inline)
        // The bar sits above the video, so it stays black like the player and the back button
        // reads as part of the picture.
        //
        // 导航栏位于视频上方, 因此与播放器一样保持黑色, 返回按钮看起来属于画面的一部分.
        .toolbarBackground(.black, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .navigationTitle("")
        .task {
            // The model loads detail before playback so source fallback can run before AVPlayer
            // starts. An open interrupted by leaving the page runs again when it comes back.
            //
            // 模型先加载详情再播放, 让视频源 fallback 在 AVPlayer 启动前完成. 离开页面而中断的打开流程,
            // 会在页面回来时重新执行.
            if viewModel == nil, let client = appVM.apiClient {
                viewModel = PlayerViewModel(
                    apiClient: client, modelContext: modelContext, serverURL: appVM.serverURL,
                    syncStore: appVM.sync?.store, syncEngine: appVM.sync?.engine,
                    sources: destination.sources, sourceKey: destination.sourceKey,
                    videoId: destination.videoId, title: destination.title,
                    coverHint: destination.coverHint,
                    initialEpisodeIndex: destination.resumeIntent?.episodeIndex,
                    localEpisodes: downloadManager
                )
            }
            await viewModel?.open(autoplay: true)
        }
        .onAppear {
            // Resumes only what was playing when the page left.
            //
            // 只恢复页面离开时正在播放的内容.
            viewModel?.appear()
        }
        .onChange(of: scenePhase) { _, phase in
            // Checkpoint before the app is suspended; the session flush may run before this one. A
            // local copy's load watchdog pauses in the background and re-arms on return.
            //
            // 应用挂起前保存进度; 会话级补写可能先于这里执行. 本地副本的加载看门狗在后台暂停,
            // 返回前台时重新启用.
            if phase == .background {
                viewModel?.checkpoint()
                viewModel?.suspendLoadWatchdog()
            } else if phase == .active {
                viewModel?.resumeLoadWatchdog()
            }
        }
        .onDisappear {
            // Going fullscreen keeps playing; only leaving the page pauses.
            //
            // 进入全屏时继续播放; 只有离开页面才暂停.
            guard !isFullScreen else { return }
            viewModel?.disappear()
        }
        .fullScreenCover(isPresented: $isFullScreen, onDismiss: { viewModel?.syncRateFromPlayer() }) {
            if let vm = viewModel, let player = vm.player {
                ZStack(alignment: .top) {
                    FullScreenPlayerRepresentable(player: player)
                        .ignoresSafeArea()
                        .background(.black)
                    // Layered over AVPlayerViewController rather than inside it: its own
                    // transport bar has no loaded indicator, and its view hierarchy is not
                    // ours to add one to.
                    //
                    // 叠加在 AVPlayerViewController 之上而非置入其中:
                    // 它自带的控制条没有已加载指示, 而其视图层级也不由我们添加.
                    PlayerBufferBadge(vm: vm)
                        .padding(.top, 28)
                }
            }
        }
        .sheet(isPresented: $showPicker) {
            if let vm = viewModel, let downloads = downloadManager, downloads.activeScopeKey != nil,
               let detail = vm.detail {
                DownloadBadgesReader(downloads: downloads, title: detail.title, sourceKey: vm.currentSourceKey,
                                     videoId: vm.currentVideoID) { snapshot in
                    EpisodePickerSheet(
                        title: detail.title, sourceName: vm.currentSourceName, episodes: vm.episodes,
                        badges: snapshot.badges,
                        hints: EpisodePickerModel.otherSourceHints(episodes: vm.episodes, downloads: snapshot.episodes,
                                                                   sourceKey: vm.currentSourceKey),
                        freeSpace: downloads.freeBytes, allowsCellular: downloads.allowsCellular
                    ) { indexes in download(vm, indexes: indexes) }
                }
                // A half-height sheet on a phone; on iPad a full form sheet, since a medium detent
                // there cuts the grid off in a floating card.
                //
                // 手机上为半高面板; iPad 上为完整的表单面板, 因为半高档位在那里会把网格截断在一张浮动卡片里.
                .presentationDetents(sizeClass == .regular ? [.large] : [.medium, .large])
            }
        }
    }

    // MARK: - Content

    /// Width from which a regular-width screen (landscape iPad) puts episodes and settings in a
    /// sidebar beside the video instead of below it.
    ///
    /// regular 宽度屏幕 (横屏 iPad) 达到该宽度时, 剧集与设置放在视频右侧的侧栏, 而非视频下方.
    private static let sidebarMinWidth: CGFloat = 1000

    @ViewBuilder
    private func content(_ vm: PlayerViewModel) -> some View {
        Group {
            if sizeClass == .regular && contentWidth >= Self.sidebarMinWidth {
                wideContent(vm)
            } else {
                stackedContent(vm)
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { contentWidth = $0 }
    }

    /// Phones and portrait iPad: the video on top, everything else scrolling below it.
    ///
    /// 手机与竖屏 iPad: 视频在上, 其余内容在下方滚动.
    private func stackedContent(_ vm: PlayerViewModel) -> some View {
        VStack(spacing: 0) {
            videoSection(vm)

            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.section) {
                    header(vm)
                    PlayerEpisodesSection(vm: vm, downloads: downloadManager)
                    PlayerSettingsSection(vm: vm)
                    PlayerErrorLabel(vm: vm)
                }
                .padding(.horizontal, Spacing.page)
                .padding(.top, Spacing.lg + 2)
                .padding(.bottom, Spacing.xxl)
                .background(alignment: .top) { backdrop(vm) }
            }
        }
    }

    /// Landscape iPad: the video and its details on the left, episodes and playback settings in a
    /// sidebar that scrolls on its own, so switching episodes never scrolls the video away.
    ///
    /// 横屏 iPad: 左侧为视频及其详情, 剧集与播放设置位于独立滚动的侧栏中, 切换剧集时视频不会被滚走.
    private func wideContent(_ vm: PlayerViewModel) -> some View {
        HStack(spacing: 0) {
            VStack(spacing: 0) {
                videoSection(vm)
                ScrollView {
                    VStack(alignment: .leading, spacing: Spacing.lg) {
                        header(vm)
                        PlayerErrorLabel(vm: vm)
                    }
                    .padding(.horizontal, Spacing.xl)
                    .padding(.top, Spacing.lg + 2)
                    .padding(.bottom, Spacing.xxl)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(alignment: .top) { backdrop(vm) }
                }
            }
            .frame(maxWidth: .infinity)

            Divider().ignoresSafeArea(edges: .bottom)

            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.section) {
                    PlayerEpisodesSection(vm: vm, downloads: downloadManager)
                    PlayerSettingsSection(vm: vm)
                }
                .padding(.horizontal, Spacing.lg)
                .padding(.top, Spacing.lg + 2)
                .padding(.bottom, Spacing.xxl)
            }
            .frame(width: max(340, contentWidth / 3))
        }
    }

    private func videoSection(_ vm: PlayerViewModel) -> some View {
        PlayerVideoSection(vm: vm) { isFullScreen = true }
    }

    private func header(_ vm: PlayerViewModel) -> some View {
        PlayerHeader(vm: vm, fallbackTitle: destination.title, downloads: downloadManager) {
            startDownload(vm)
        }
    }

    private func backdrop(_ vm: PlayerViewModel) -> some View {
        PlayerBackdrop(vm: vm, fallbackTitle: destination.title, fallbackCover: destination.coverHint,
                       resolveCover: coverURL)
    }

    // MARK: - Downloads

    private func coverURL(_ cover: String) -> URL? {
        resolveAssetURL(cover, baseURL: appVM.apiClient?.baseURL)
    }

    /// The download button: a series opens the episode picker; a single episode is queued at once.
    ///
    /// 下载按钮: 剧集多于一集时打开选集面板; 只有一集时直接加入下载.
    private func startDownload(_ vm: PlayerViewModel) {
        guard let downloads = downloadManager else { return }
        if vm.episodes.count > 1 {
            downloads.refreshStorage()
            showPicker = true
        } else {
            download(vm, indexes: [vm.currentEpisodeIndex])
        }
    }

    private func download(_ vm: PlayerViewModel, indexes: [Int]) {
        guard let downloads = downloadManager,
              let outcome = vm.enqueueDownloads(indexes, into: downloads, coverURL: coverURL(vm.detail?.cover ?? ""))
        else { return }
        let toast = outcome.toast
        ToastManager.shared.show(toast.message, style: toast.style)
    }
}

/// The page's error line, its own view so an error change re-renders only this line.
///
/// 页面的错误提示行; 作为独立视图, 错误变化只会重新渲染这一行.
private struct PlayerErrorLabel: View {
    let vm: PlayerViewModel

    var body: some View {
        if let error = vm.error {
            Label(error, systemImage: "exclamationmark.triangle.fill")
                .font(AppFont.footnote)
                .foregroundStyle(StatusColor.danger)
        }
    }
}

/// The cover, heavily blurred, fading from the top of the page into the canvas; it tints the
/// header with the show's colors.
///
/// 高度模糊的封面, 自页面顶部渐隐到背景色; 用剧集自身的色彩为头部着色.
private struct PlayerBackdrop: View {
    let vm: PlayerViewModel
    let fallbackTitle: String
    let fallbackCover: String
    let resolveCover: (String) -> URL?
    @Environment(\.colorScheme) private var colorScheme
    @Environment(CoverRegistry.self) private var covers: CoverRegistry?

    var body: some View {
        let url = resolveCover(vm.detail?.cover ?? fallbackCover)
        let title = vm.detail?.title ?? fallbackTitle
        if url != nil || covers?.cover(for: title) != nil {
            ArtworkImage(url: url, title: title, showsPlaceholder: false)
                .frame(height: 280)
                .frame(maxWidth: .infinity)
                .blur(radius: 50, opaque: true)
                .opacity(colorScheme == .dark ? 0.45 : 0.35)
                .clipped()
                .mask(LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom))
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }
}
#endif
