import SwiftUI
import SwiftData

@main
struct KMTVTVApp: App {
    let container: ModelContainer

    init() {
        do {
            container = try AppModelContainer.make()
        } catch {
            fatalError("Failed to create ModelContainer: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            TVRootView()
                .modelContainer(container)
        }
    }
}

struct TVRootView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.scenePhase) private var scenePhase
    @State private var appVM: AppViewModel?

    var body: some View {
        ZStack(alignment: .top) {
            tvContentView
            tvToastBanner
                .zIndex(100)
        }
        .task {
            // One view model for the app's lifetime: the task re-runs when the view reappears. A rerun
            // bootstraps again only when a cancelled run left the app still loading.
            //
            // 整个 App 生命周期只有一个视图模型: 视图重新出现时该任务会再次运行. 只有当被取消的那次运行
            // 让 App 仍停留在加载中时, 重新运行才会再次启动.
            let vm = appVM ?? AppViewModel(modelContext: modelContext)
            appVM = vm
            guard case .loading = vm.state else { return }
            await vm.bootstrap()
        }
        .onChange(of: scenePhase) { _, phase in
            appVM?.handleScenePhase(phase)
        }
    }

    @ViewBuilder
    private var tvContentView: some View {
        if let appVM {
            AppRootSwitch(appVM: appVM) {
                TVContentView()
            }
        } else {
            ProgressView()
        }
    }

    @ViewBuilder
    private var tvToastBanner: some View {
        let toast = ToastManager.shared
        if let message = toast.currentMessage {
            ToastView(message: message, style: toast.currentStyle)
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .opacity(toast.isVisible ? 1 : 0)
                .animation(.easeInOut(duration: 0.3), value: toast.isVisible)
        }
    }
}
