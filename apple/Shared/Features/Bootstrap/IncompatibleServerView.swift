import SwiftUI

/// Shown when the server is older than `VersionCompatibility.minimumServerVersion`; the only way on
/// is another server.
///
/// 服务端版本低于 `VersionCompatibility.minimumServerVersion` 时显示; 只能更换服务器继续.
struct IncompatibleServerView: View {
    let serverVersion: String
    let requiredVersion: String
    @Environment(AppViewModel.self) private var appVM

    var body: some View {
        VStack(spacing: Self.spacing) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: Self.iconSize))
                .foregroundStyle(StatusColor.warning)
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

    #if os(tvOS)
    private static let spacing: CGFloat = 24
    private static let iconSize: CGFloat = 64
    #else
    private static let spacing: CGFloat = 16
    private static let iconSize: CGFloat = 48
    #endif
}
