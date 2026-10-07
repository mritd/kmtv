import SwiftUI

/// The root screen for each `AppState`, shared by iOS and tvOS. The connecting, setup, and
/// incompatible-server screens are the same on both; each platform passes its signed-in screen, and
/// iOS its offline screen. Every screen gets the app view model in its environment.
///
/// iOS 与 tvOS 共用的根页面, 按 `AppState` 切换. 连接页, 设置页与服务端不兼容页在两个平台相同;
/// 各平台传入自己的已登录页面, iOS 另外传入离线页面. 每个页面的环境中都有 App 视图模型.
struct AppRootSwitch<Authenticated: View, Offline: View>: View {
    let appVM: AppViewModel
    private let authenticated: () -> Authenticated
    #if os(iOS)
    private let offline: () -> Offline

    init(appVM: AppViewModel, @ViewBuilder authenticated: @escaping () -> Authenticated,
         @ViewBuilder offline: @escaping () -> Offline) {
        self.appVM = appVM
        self.authenticated = authenticated
        self.offline = offline
    }
    #endif

    var body: some View {
        Group {
            switch appVM.state {
            case .loading:
                ConnectingView(serverAddress: appVM.serverURL)
            case .serverSetup:
                ServerSetupView()
            case .authenticated:
                authenticated()
            #if os(iOS)
            case .offline:
                offline()
            #endif
            case .incompatibleServer(let serverVersion, let requiredVersion):
                IncompatibleServerView(serverVersion: serverVersion, requiredVersion: requiredVersion)
            }
        }
        .environment(appVM)
    }
}

#if os(tvOS)
extension AppRootSwitch where Offline == EmptyView {
    /// tvOS has no downloads, so the app never goes offline there and needs no offline screen.
    ///
    /// tvOS 没有下载功能, App 在 tvOS 上不会进入离线状态, 因此不需要离线页面.
    init(appVM: AppViewModel, @ViewBuilder authenticated: @escaping () -> Authenticated) {
        self.appVM = appVM
        self.authenticated = authenticated
    }
}
#endif
