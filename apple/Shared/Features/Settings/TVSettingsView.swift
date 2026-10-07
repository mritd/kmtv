#if os(tvOS)
import SwiftUI

struct TVSettingsView: View {
    @Environment(AppViewModel.self) private var appVM
    @State private var confirmClearHistory = false

    var body: some View {
        List {
            if let user = appVM.currentUser {
                Section(String(localized: "Account")) {
                    HStack {
                        Text(String(localized: "Username"))
                            .foregroundStyle(.primary)
                        Spacer()
                        Text(user.username)
                            .foregroundStyle(.secondary)
                    }
                    HStack {
                        Text(String(localized: "Role"))
                            .foregroundStyle(.primary)
                        Spacer()
                        Text(user.roleDisplayName)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Section(String(localized: "Server")) {
                HStack {
                    Text(String(localized: "Server Address"))
                        .foregroundStyle(.primary)
                    Spacer()
                    Text(appVM.serverURL)
                        .foregroundStyle(.secondary)
                    if !appVM.serverVersion.isEmpty {
                        Text(appVM.serverVersion)
                            .font(.caption)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(.blue.opacity(0.2))
                            .clipShape(Capsule())
                    }
                }
            }

            Section {
                Button(String(localized: "Clear Watch History"), role: .destructive) { confirmClearHistory = true }
            }

            Section {
                Button(String(localized: "Sign Out"), role: .destructive) {
                    Task { await appVM.logout() }
                }
            }
        }
        .confirmationDialog(String(localized: "Clear watch history on all devices?"), isPresented: $confirmClearHistory,
                            titleVisibility: .visible) {
            Button(String(localized: "Clear"), role: .destructive) {
                ProfileViewModel.clearWatchHistory(in: appVM.sync?.store)
            }
        } message: {
            Text(String(localized: "This removes your watch history on every device signed in to this account and cannot be undone."))
        }
        .task {
            await appVM.fetchServerVersion()
        }
    }
}
#endif
