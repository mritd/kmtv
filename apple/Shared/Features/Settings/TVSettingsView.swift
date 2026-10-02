import SwiftUI

struct TVSettingsView: View {
    @Environment(AppViewModel.self) private var appVM

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
                        Text(user.role == "admin" ? String(localized: "Admin") : String(localized: "Regular User"))
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
                Button(String(localized: "Clear Watch History"), role: .destructive) { appVM.sync?.store.clear(.watch) }
            }

            Section {
                Button(String(localized: "Sign Out"), role: .destructive) {
                    Task { await appVM.logout() }
                }
            }
        }
        #if os(iOS)
        .scrollContentBackground(.hidden)
        .background(Theme.bgPrimary)
        .navigationTitle("Settings")
        #endif
        .task {
            await appVM.fetchServerVersion()
        }
    }
}
