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

    var body: some Scene {
        WindowGroup {
            RootView(downloads: downloads)
                .modelContainer(container)
                .environment(downloads)
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
    @State private var appVM: AppViewModel?

    var body: some View {
        ZStack(alignment: .top) {
            contentView
            toastBanner
                .allowsHitTesting(false)
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
            case .serverSetup:
                ServerSetupView()
                    .environment(appVM)
            case .authenticated:
                ContentView()
                    .environment(appVM)
            case .offline(let identity):
                OfflineRootView(identity: identity)
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

    @ViewBuilder
    private var toastBanner: some View {
        let toast = ToastManager.shared
        if let message = toast.currentMessage {
            ToastView(message: message)
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .opacity(toast.isVisible ? 1 : 0)
                .animation(.easeInOut(duration: 0.3), value: toast.isVisible)
        }
    }
}
