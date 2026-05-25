import SwiftUI
import SwiftData
#if canImport(UIKit)
import UIKit
#endif
#if os(iOS)
import PhotosUI
#endif

struct ProfileView: View {
    @Environment(AppViewModel.self) private var appVM
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: ProfileViewModel?
    #if os(iOS)
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var showPhotoPicker = false
    @State private var showAvatarOptions = false
    #endif

    var body: some View {
        Group {
            if let viewModel {
                content(viewModel)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Me")
        .task {
            if viewModel == nil, let client = appVM.apiClient {
                let vm = ProfileViewModel(apiClient: client, modelContext: modelContext,
                                           serverURL: appVM.serverURL, user: appVM.currentUser, appVM: appVM)
                viewModel = vm
                vm.load()
            } else {
                viewModel?.load()
            }
            await appVM.fetchServerVersion()
        }
    }

    @ViewBuilder
    private func content(_ vm: ProfileViewModel) -> some View {
        List {
            userInfoSection(vm)
            navigationSection(vm)
            if !isAnonymous {
                passwordSection(vm)
            }
            dangerSection(vm)
        }
        #if os(iOS)
        .scrollContentBackground(.hidden)
        #endif
        .background(Theme.bgPrimary)
        .alert("OK", isPresented: .init(get: { vm.successMessage != nil }, set: { if !$0 { vm.successMessage = nil } })) {
            Button("OK") { vm.successMessage = nil }
        } message: {
            Text(vm.successMessage ?? "")
        }
    }

    @ViewBuilder
    private func userInfoSection(_ vm: ProfileViewModel) -> some View {
        Section {
            HStack(spacing: 16) {
                avatarView(vm)
                VStack(alignment: .leading, spacing: 4) {
                    if isAnonymous {
                        Text("Anonymous User")
                            .font(.headline)
                            .accessibilityIdentifier("anonymousUserLabel")
                    } else if vm.isEditingUsername {
                        HStack(spacing: 8) {
                            TextField("Username", text: Binding(get: { vm.editUsername }, set: { vm.editUsername = $0 }))
                                .font(.headline)
                                #if os(iOS)
                                .textFieldStyle(.roundedBorder)
                                #endif
                            Button {
                                Task { await vm.updateUsername() }
                            } label: {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(Theme.accent)
                            }
                            .accessibilityIdentifier("confirmUsernameButton")
                            .disabled(vm.editUsername.trimmingCharacters(in: .whitespaces).isEmpty)
                            Button {
                                vm.isEditingUsername = false
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundStyle(Theme.textSecondary)
                            }
                            .accessibilityIdentifier("cancelUsernameButton")
                        }
                    } else {
                        HStack(spacing: 8) {
                            Text(vm.user?.username ?? String(localized: "Unknown"))
                                .font(.headline)
                            Button {
                                vm.editUsername = vm.user?.username ?? ""
                                vm.isEditingUsername = true
                            } label: {
                                Image(systemName: "pencil")
                                    .font(.caption)
                                    .foregroundStyle(Theme.textSecondary)
                            }
                            .accessibilityIdentifier("editUsernameButton")
                        }
                    }
                    if !isAnonymous {
                        Text(vm.user?.role == "admin" ? String(localized: "Admin") : String(localized: "Regular User"))
                            .font(.caption)
                            .foregroundStyle(vm.user?.role == "admin" ? Color.orange : Color.green)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(vm.user?.role == "admin" ? Color.orange.opacity(0.2) : Color.green.opacity(0.2))
                            .clipShape(Capsule())
                            .accessibilityIdentifier("roleBadge")
                    }
                }
            }
            .listRowBackground(Theme.bgCard)

            // Server info.
            // 当前连接的服务器信息.
            HStack {
                Image(systemName: "server.rack")
                    .foregroundStyle(Theme.textSecondary)
                Text(appVM.serverURL)
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
                if !appVM.serverVersion.isEmpty {
                    Text(appVM.serverVersion)
                        .font(.caption2)
                        .foregroundStyle(Theme.accent)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Theme.accent.opacity(0.2))
                        .clipShape(Capsule())
                }
            }
            .listRowBackground(Theme.bgCard)
        }
    }

    @ViewBuilder
    private func avatarView(_ vm: ProfileViewModel) -> some View {
        let avatarContent = Group {
            if let avatarPath = vm.user?.avatar, !avatarPath.isEmpty {
                AuthenticatedAvatarImage(apiClient: appVM.apiClient, path: avatarPath)
            } else if isAnonymous {
                Image(systemName: "person.crop.circle.fill")
                    .resizable()
                    .scaledToFit()
                    .foregroundStyle(Theme.textSecondary)
                    .frame(width: 56, height: 56)
            } else {
                Text(String(vm.user?.username.prefix(1).uppercased() ?? "?"))
                    .font(.title2.bold())
                    .foregroundStyle(Theme.textSecondary)
            }
        }

        let avatar = Circle()
            .fill(Theme.bgCard)
            .frame(width: 60, height: 60)
            .overlay { avatarContent }
            .clipShape(Circle())

        if isAnonymous {
            avatar
        } else {
            #if os(iOS)
            Button {
                showAvatarOptions = true
            } label: {
                avatar
            }
            .buttonStyle(.plain)
            .confirmationDialog("Change Avatar", isPresented: $showAvatarOptions) {
                Button("Change Avatar") {
                    showPhotoPicker = true
                }
                if vm.user?.avatar != nil && !(vm.user?.avatar?.isEmpty ?? true) {
                    Button("Remove Avatar", role: .destructive) {
                        Task { await vm.deleteAvatar() }
                    }
                }
            }
            .photosPicker(isPresented: $showPhotoPicker, selection: $selectedPhoto, matching: .images)
            .onChange(of: selectedPhoto) { _, newValue in
                guard let newValue else { return }
                Task {
                    if let data = try? await newValue.loadTransferable(type: Data.self) {
                        await vm.uploadAvatar(imageData: data)
                        selectedPhoto = nil
                    }
                }
            }
            #else
            avatar
            #endif
        }
    }

    @ViewBuilder
    private func navigationSection(_ vm: ProfileViewModel) -> some View {
        Section {
            if vm.user?.role == "admin" {
                NavigationLink("Admin Panel") {
                    AdminView()
                }
            }
        }
    }

    @ViewBuilder
    private func passwordSection(_ vm: ProfileViewModel) -> some View {
        Section {
            Button("Change Password") {
                vm.isChangingPassword.toggle()
            }
            if vm.isChangingPassword {
                SecureField("Current Password", text: Binding(get: { vm.passwordOld }, set: { vm.passwordOld = $0 }))
                SecureField("New Password", text: Binding(get: { vm.passwordNew }, set: { vm.passwordNew = $0 }))
                SecureField("Confirm Password", text: Binding(get: { vm.passwordConfirm }, set: { vm.passwordConfirm = $0 }))
            }
        }

        if vm.isChangingPassword {
            Section {
                Button {
                    Task { await vm.changePassword() }
                } label: {
                    Text("Save Password")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(vm.passwordNew.isEmpty)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                .listRowBackground(Color.clear)
            }
        }
    }

    private var isAnonymous: Bool {
        appVM.currentUser == nil || appVM.currentUser?.id == 0
    }

    @ViewBuilder
    private func dangerSection(_ vm: ProfileViewModel) -> some View {
        Section {
            Button("Clear Watch History") {
                vm.clearWatchHistory()
            }
            .foregroundStyle(.red)
        }

        Section {
            Button("Sign Out") {
                Task { await appVM.logout() }
            }
            .foregroundStyle(.red)
            .accessibilityIdentifier("signOutButton")
        }
    }
}

#if canImport(UIKit)
private struct AuthenticatedAvatarImage: View {
    let apiClient: APIClient?
    let path: String
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                ProgressView()
            }
        }
        .task(id: path) {
            await load()
        }
    }

    /// Loads avatar bytes through APIClient so protected avatar routes get bearer auth.
    /// 通过 APIClient 加载头像数据, 确保受保护头像接口携带 bearer 认证.
    private func load() async {
        guard let apiClient else { return }
        guard let data = try? await apiClient.getData(path) else { return }
        image = UIImage(data: data)
    }
}
#endif
