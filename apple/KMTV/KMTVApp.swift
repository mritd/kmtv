import SwiftUI
import SwiftData

@main
struct KMTVApp: App {
    let container: ModelContainer

    init() {
        do {
            container = try ModelContainer(
                for: Server.self, WatchHistoryItem.self, FavoriteItem.self, SearchHistoryItem.self, PlaybackSettings.self
            )
        } catch {
            fatalError("Failed to create ModelContainer: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .modelContainer(container)
        }
    }
}

struct RootView: View {
    @Environment(\.modelContext) private var modelContext
    @State private var appVM: AppViewModel?

    var body: some View {
        ZStack(alignment: .top) {
            contentView
            toastBanner
                .allowsHitTesting(false)
        }
        .task {
            let vm = AppViewModel(modelContext: modelContext)
            appVM = vm
            await vm.bootstrap()
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
