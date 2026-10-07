import SwiftUI
import SwiftData

@main
@MainActor
struct KMTVApp: App {
    let container: ModelContainer
    let downloads: DownloadManager
    @Environment(\.scenePhase) private var scenePhase

    init() {
        do {
            container = try AppModelContainer.make()
        } catch {
            fatalError("Failed to create ModelContainer: \(error)")
        }
        // Created before any view: a background relaunch for session events may never render one.
        //
        // 在任何视图之前创建: 因 session 事件触发的后台唤醒可能根本不会渲染视图.
        let layout = (try? DownloadLayout.makeDefault())
            ?? DownloadLayout(root: FileManager.default.temporaryDirectory.appending(path: "Downloads"))
        downloads = DownloadManager(context: container.mainContext, layout: layout,
                                    transport: BackgroundDownloadTransport(layout: layout),
                                    network: DownloadNetworkMonitor())
    }

    /// Whether the process hosts unit tests. The app then shows nothing and never bootstraps, so
    /// a test that posts `.authExpired` or saves an identity cannot sign out or overwrite the real
    /// session stored on the simulator. `RootView` is never built either, so the cover registry over
    /// `UserDefaults.standard` is never created; tests build their own.
    ///
    /// 进程是否作为单元测试宿主运行. 此时 App 不显示任何内容, 也不执行启动流程, 因此发送
    /// `.authExpired` 或保存身份的测试不会登出或覆盖模拟器上保存的真实会话. `RootView` 也不会被创建,
    /// 因此基于 `UserDefaults.standard` 的封面登记表从不创建; 测试会创建自己的登记表.
    static let hostsUnitTests = ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil

    var body: some Scene {
        WindowGroup {
            if Self.hostsUnitTests {
                Color.clear
            } else {
                RootView(downloads: downloads)
                    .modelContainer(container)
                    .environment(downloads)
            }
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            Task { await downloads.handleScenePhase(phase) }
        }
        .backgroundTask(.urlSession(BackgroundDownloadTransport.identifier)) {
            await downloads.handleBackgroundWake()
        }
    }
}

struct RootView: View {
    let downloads: DownloadManager
    @Environment(\.modelContext) private var modelContext
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var appVM: AppViewModel?
    /// The app's cover registry. A lazy static, so it is created once, on the first body of this view
    /// (a `@State` default would build and discard one each time the app body re-creates this view),
    /// and the unit test host, which never builds this view, never opens it.
    ///
    /// App 的封面登记表. 使用惰性静态属性, 因此只会在本视图首次求值时创建一次 (`@State` 默认值会在 App
    /// 主体每次重建本视图时创建并丢弃一个实例), 且从不创建本视图的单元测试宿主也不会打开它.
    private static let appCovers = CoverRegistry(defaults: .standard)
    private var covers: CoverRegistry { Self.appCovers }
    @AppStorage(AppearanceKeys.theme) private var storedTheme = AppTheme.fallback.rawValue
    @AppStorage(AppearanceKeys.mode) private var storedMode = AppearanceMode.system.rawValue

    var body: some View {
        let theme = AppTheme(stored: storedTheme)
        // At the top on phones; at the bottom on regular widths, where the tab bar floats at the top.
        //
        // 手机上位于顶部; regular 宽度下标签栏浮在顶部, 因此位于底部.
        ZStack(alignment: sizeClass == .regular ? .bottom : .top) {
            contentView
            toastBanner
                .allowsHitTesting(false)
        }
        .tint(theme.accent)
        .environment(\.appTheme, theme)
        .environment(covers)
        .preferredColorScheme(AppearanceMode(stored: storedMode).colorScheme)
        .onChange(of: storedTheme, initial: true) { _, stored in
            Self.applyWindowTint(AppTheme(stored: stored))
        }
        .task {
            // One view model for the app's lifetime: the task re-runs when the view reappears. A rerun
            // bootstraps again only when a cancelled run left the app still loading.
            //
            // 整个 App 生命周期只有一个视图模型: 视图重新出现时该任务会再次运行. 只有当被取消的那次运行
            // 让 App 仍停留在加载中时, 重新运行才会再次启动.
            let vm = appVM ?? AppViewModel(modelContext: modelContext, downloads: downloads)
            appVM = vm
            guard case .loading = vm.state else { return }
            await vm.bootstrap()
        }
        .onChange(of: scenePhase) { _, phase in
            appVM?.handleScenePhase(phase)
        }
    }

    @ViewBuilder
    private var contentView: some View {
        if let appVM {
            AppRootSwitch(appVM: appVM) {
                ContentView()
            } offline: {
                OfflineRootView()
            }
        } else {
            ProgressView()
        }
    }

    /// `.tint` stops at SwiftUI; alerts, text field cursors, and other UIKit-hosted controls read
    /// the window's tint, so it follows the theme too.
    ///
    /// `.tint` 只作用于 SwiftUI; 弹窗, 文本框光标等 UIKit 承载的控件读取 window 的 tint, 因此它也跟随主题.
    private static func applyWindowTint(_ theme: AppTheme) {
        for scene in UIApplication.shared.connectedScenes {
            for window in (scene as? UIWindowScene)?.windows ?? [] {
                window.tintColor = theme.uiAccent
            }
        }
    }

    @ViewBuilder
    private var toastBanner: some View {
        let toast = ToastManager.shared
        if let message = toast.currentMessage {
            ToastView(message: message, style: toast.currentStyle)
                .padding(.horizontal, 16)
                .padding(sizeClass == .regular ? .bottom : .top, sizeClass == .regular ? Spacing.xl : 8)
                .opacity(toast.isVisible ? 1 : 0)
                .animation(.easeInOut(duration: 0.3), value: toast.isVisible)
        }
    }
}
