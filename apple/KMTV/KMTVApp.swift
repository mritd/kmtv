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
        // View model tests record covers; keep them out of the real registry.
        //
        // 视图模型测试会登记封面; 让它们不进入真实的登记表.
        if Self.hostsUnitTests, let store = UserDefaults(suiteName: "KMTVTests.covers") {
            store.removePersistentDomain(forName: "KMTVTests.covers")
            CoverRegistry.use(store)
        }
    }

    /// Whether the process hosts unit tests. The app then shows nothing and never bootstraps, so
    /// a test that posts `.authExpired` or saves an identity cannot sign out or overwrite the real
    /// session stored on the simulator.
    ///
    /// 进程是否作为单元测试宿主运行. 此时 App 不显示任何内容, 也不执行启动流程, 因此发送
    /// `.authExpired` 或保存身份的测试不会登出或覆盖模拟器上保存的真实会话.
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
        .preferredColorScheme(AppearanceMode(stored: storedMode).colorScheme)
        .onChange(of: storedTheme, initial: true) { _, stored in
            Self.applyWindowTint(AppTheme(stored: stored))
        }
        .task {
            let vm = AppViewModel(modelContext: modelContext, downloads: downloads)
            appVM = vm
            await vm.bootstrap()
        }
        .onChange(of: scenePhase) { _, phase in
            appVM?.handleScenePhase(phase)
        }
    }

    @ViewBuilder
    private var contentView: some View {
        if let appVM {
            switch appVM.state {
            case .loading:
                ConnectingView(serverAddress: appVM.serverURL)
                    .environment(appVM)
            case .serverSetup:
                ServerSetupView()
                    .environment(appVM)
            case .authenticated:
                ContentView()
                    .environment(appVM)
            case .offline:
                OfflineRootView()
                    .environment(appVM)
            case .incompatibleServer(let serverVersion, let requiredVersion):
                VStack(spacing: 16) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 48))
                        .foregroundStyle(.orange)
                    Text(String(localized: "Server Incompatible"))
                        .font(.title2.bold())
                    Text("Server version \(serverVersion) is too old. This app requires \(requiredVersion) or later.")
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                    Button(String(localized: "Change Server")) {
                        appVM.disconnectServer()
                    }
                }
                .padding()
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
