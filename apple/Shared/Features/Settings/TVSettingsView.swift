import SwiftData
import SwiftUI

struct TVSettingsView: View {
    @Environment(AppViewModel.self) private var appVM
    @Environment(\.modelContext) private var modelContext
    @State private var watchHistoryCount = 0

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
                Button(String(localized: "Clear Watch History"), role: .destructive) {
                    WatchHistoryItem.clearAll(in: modelContext, serverURL: appVM.serverURL)
                    try? modelContext.save()
                    watchHistoryCount = 0
                }
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
            let serverURL = appVM.serverURL
            let descriptor = FetchDescriptor<WatchHistoryItem>(predicate: #Predicate { $0.serverURL == serverURL })
            watchHistoryCount = (try? modelContext.fetchCount(descriptor)) ?? 0
            await appVM.fetchServerVersion()
        }
    }
}
