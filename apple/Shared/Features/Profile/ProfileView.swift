#if os(iOS)
import SwiftUI
import SwiftData
import UIKit
import PhotosUI
import Kingfisher
import CryptoKit

struct ProfileView: View {
    @Environment(AppViewModel.self) private var appVM
    @Environment(\.appTheme) private var theme
    @State private var viewModel: ProfileViewModel?
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var showPhotoPicker = false
    @State private var showAvatarOptions = false

    var body: some View {
        Group {
            if let viewModel {
                content(viewModel)
            } else {
                ProgressView()
            }
        }
        .readableColumn()
        .navigationTitle("Me")
        .task {
            if viewModel == nil, let client = appVM.apiClient {
                let vm = ProfileViewModel(apiClient: client, syncStore: appVM.sync?.store,
                                           user: appVM.currentUser, appVM: appVM)
                viewModel = vm
            }
            await appVM.fetchServerVersion()
        }
    }

    @ViewBuilder
    private func content(_ vm: ProfileViewModel) -> some View {
        List {
            userInfoSection(vm)
            AppearanceSection()
            // A signed-in user's scope is nil until activation finishes; showing the section then
            // would count their own downloads as another account's.
            //
            // 已登录用户的作用域在激活完成前为 nil; 此时显示会把其自己的下载算作其他账号的.
            if let downloads = appVM.downloadManager, isAnonymous || downloads.activeScopeKey != nil {
                DownloadsSettingsSection(downloads: downloads, scope: isAnonymous ? nil : downloads.activeScopeKey)
            }
            accountSection(vm)
            dangerSection(vm)
        }
        .alert("OK", isPresented: .init(get: { vm.successMessage != nil }, set: { if !$0 { vm.successMessage = nil } })) {
            Button("OK") { vm.successMessage = nil }
        } message: {
            Text(vm.successMessage ?? "")
        }
    }

    @ViewBuilder
    private func userInfoSection(_ vm: ProfileViewModel) -> some View {
        Section {
            HStack(spacing: Spacing.lg) {
                avatarView(vm)
                VStack(alignment: .leading, spacing: Spacing.xs + 2) {
                    if isAnonymous {
                        Text("Anonymous User")
                            .font(AppFont.section)
                            .accessibilityIdentifier("anonymousUserLabel")
                    } else if vm.isEditingUsername {
                        HStack(spacing: Spacing.sm) {
                            TextField("Username", text: Binding(get: { vm.editUsername }, set: { vm.editUsername = $0 }))
                                .font(AppFont.body)
                                .textFieldStyle(.roundedBorder)
                            Button {
                                Task { await vm.updateUsername() }
                            } label: {
                                Image(systemName: "checkmark.circle.fill")
                                    .font(.title3)
                                    .foregroundStyle(.tint)
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("confirmUsernameButton")
                            .disabled(vm.editUsername.trimmingCharacters(in: .whitespaces).isEmpty)
                            Button {
                                vm.isEditingUsername = false
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .font(.title3)
                                    .foregroundStyle(.secondary)
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("cancelUsernameButton")
                        }
                    } else {
                        HStack(spacing: Spacing.sm) {
                            Text(vm.user?.username ?? String(localized: "Unknown"))
                                .font(AppFont.section)
                                .lineLimit(1)
                            if !isAnonymous {
                                roleBadge(isAdmin: vm.user?.role == "admin")
                            }
                            Button {
                                vm.editUsername = vm.user?.username ?? ""
                                vm.isEditingUsername = true
                            } label: {
                                Image(systemName: "pencil")
                                    .font(AppFont.footnote.weight(.semibold))
                                    .foregroundStyle(.secondary)
                                    .frame(width: 28, height: 28)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(Text("Edit Username"))
                            .accessibilityIdentifier("editUsernameButton")
                        }
                    }
                    Label {
                        Text(DisplayFormatters.metaLine([serverHost, appVM.serverVersion], separator: " · "))
                            .lineLimit(1)
                    } icon: {
                        Image(systemName: "server.rack")
                    }
                    .font(AppFont.footnote)
                    .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, Spacing.xs)
        }
    }

    private func roleBadge(isAdmin: Bool) -> some View {
        Text(isAdmin ? String(localized: "Admin") : String(localized: "Regular User"))
            .font(AppFont.meta.weight(.semibold))
            .foregroundStyle(isAdmin ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
            .padding(.horizontal, Spacing.sm)
            .padding(.vertical, 2)
            .background(isAdmin ? theme.accentTint : Surface.fill, in: Capsule())
            .lineLimit(1)
            .fixedSize()
            .accessibilityIdentifier("roleBadge")
    }

    /// The server address without its scheme, for the compact account line.
    ///
    /// 去掉协议前缀的服务器地址, 用于紧凑的账号信息行.
    private var serverHost: String {
        appVM.serverURL.replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: "")
    }

    @ViewBuilder
    private func avatarView(_ vm: ProfileViewModel) -> some View {
        let avatarContent = Group {
            let fallback = AvatarFallback(username: vm.user?.username, isAnonymous: isAnonymous)
            if let avatarPath = vm.user?.avatar, !avatarPath.isEmpty {
                AuthenticatedAvatarImage(apiClient: appVM.apiClient, path: avatarPath, fallback: fallback)
            } else {
                fallback
            }
        }

        let avatar = Circle()
            .fill(isAnonymous ? Surface.fill : theme.accentTint)
            .frame(width: 60, height: 60)
            .overlay { avatarContent }
            .clipShape(Circle())

        if isAnonymous {
            avatar
        } else {
            Button {
                showAvatarOptions = true
            } label: {
                avatar
            }
            .buttonStyle(.pressable)
            .accessibilityLabel(Text("Change Avatar"))
            .accessibilityIdentifier("avatarButton")
            .confirmationDialog("Change Avatar", isPresented: $showAvatarOptions) {
                Button("Change Avatar") {
                    showPhotoPicker = true
                }
                // The server's default avatar is not an upload, so there is nothing to remove.
                //
                // 服务端默认头像不是用户上传的, 因此没有可删除的内容.
                if vm.user?.hasUploadedAvatar == true {
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
        }
    }

    @ViewBuilder
    private func accountSection(_ vm: ProfileViewModel) -> some View {
        if vm.user?.role == "admin" || !isAnonymous {
            Section {
                if vm.user?.role == "admin" {
                    NavigationLink {
                        AdminView()
                    } label: {
                        Label("Admin Panel", systemImage: "slider.horizontal.3")
                    }
                }
                if !isAnonymous {
                    Button {
                        withAnimation { vm.isChangingPassword.toggle() }
                    } label: {
                        Label("Change Password", systemImage: "key")
                            .foregroundStyle(.primary)
                    }
                    if vm.isChangingPassword {
                        SecureField("Current Password", text: Binding(get: { vm.passwordOld }, set: { vm.passwordOld = $0 }))
                        SecureField("New Password", text: Binding(get: { vm.passwordNew }, set: { vm.passwordNew = $0 }))
                        SecureField("Confirm Password", text: Binding(get: { vm.passwordConfirm }, set: { vm.passwordConfirm = $0 }))
                        Button("Save Password") {
                            Task { await vm.changePassword() }
                        }
                        .font(AppFont.bodyEmphasis)
                        .disabled(vm.passwordNew.isEmpty)
                    }
                }
            } header: {
                Text("Account")
            }
        }
    }

    private var isAnonymous: Bool {
        appVM.currentUser == nil || appVM.currentUser?.id == 0
    }

    @ViewBuilder
    private func dangerSection(_ vm: ProfileViewModel) -> some View {
        Section {
            Button("Clear Watch History", role: .destructive) {
                vm.clearWatchHistory()
            }
            .foregroundStyle(.red)
            Button("Sign Out", role: .destructive) {
                Task { await appVM.logout() }
            }
            .foregroundStyle(.red)
            .accessibilityIdentifier("signOutButton")
        }
    }
}

/// Theme and appearance mode; both are per-device preferences.
///
/// 主题色与外观模式; 两者都是本机偏好.
private struct AppearanceSection: View {
    @AppStorage(AppearanceKeys.theme) private var storedTheme = AppTheme.fallback.rawValue
    @AppStorage(AppearanceKeys.mode) private var storedMode = AppearanceMode.system.rawValue

    var body: some View {
        let current = AppTheme(stored: storedTheme)
        Section {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack {
                    Text("Theme Color")
                    Spacer()
                    Text(current.displayName).foregroundStyle(.secondary)
                }
                HStack {
                    ForEach(AppTheme.allCases) { theme in
                        Button {
                            storedTheme = theme.rawValue
                        } label: {
                            Circle()
                                .fill(theme.accent)
                                .frame(width: 34, height: 34)
                                .padding(4)
                                .overlay {
                                    Circle().strokeBorder(theme == current ? theme.accent : .clear, lineWidth: 2)
                                }
                                .frame(maxWidth: .infinity)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.pressable)
                        .accessibilityLabel(Text(theme.displayName))
                        .accessibilityAddTraits(theme == current ? .isSelected : [])
                        .accessibilityIdentifier("theme_\(theme.rawValue)")
                    }
                }
            }
            .padding(.vertical, Spacing.xs)

            Picker("Appearance", selection: $storedMode) {
                ForEach(AppearanceMode.allCases) { mode in
                    Text(mode.displayName).tag(mode.rawValue)
                }
            }
            .pickerStyle(.segmented)
            .listRowSeparator(.hidden, edges: .bottom)
            .accessibilityIdentifier("appearanceModePicker")
        } header: {
            Text("Appearance")
        }
        .animation(.easeOut(duration: 0.2), value: storedTheme)
    }
}

/// Loads an avatar through `APIClient`, so protected avatar routes get bearer auth, and plays it
/// when animated (the server's default avatar is a GIF), holding the first frame under Reduce
/// Motion. Shows `fallback` when loading fails.
///
/// 通过 `APIClient` 加载头像, 确保受保护的头像接口携带 bearer 认证; 动图会播放 (服务端默认头像是
/// GIF), 开启减弱动态效果时停在第一帧. 加载失败时显示 `fallback`.
private struct AuthenticatedAvatarImage: View {
    let apiClient: APIClient?
    let path: String
    let fallback: AvatarFallback
    @State private var data: Data?
    @State private var failed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if let data {
                if reduceMotion, let still = UIImage(data: data) {
                    Image(uiImage: still)
                        .resizable()
                        .scaledToFill()
                } else {
                    KFAnimatedImage(source: .provider(RawImageDataProvider(data: data, cacheKey: Self.cacheKey(for: data))))
                        .configure { view in view.contentMode = .scaleAspectFill }
                }
            } else if failed {
                fallback
            } else {
                ProgressView()
            }
        }
        .task(id: path) {
            await load()
        }
    }

    /// Keyed by content: Kingfisher answers from its cache by key before reading the data, and older
    /// servers reuse one avatar URL per username across uploads and servers.
    ///
    /// 按内容生成缓存键: Kingfisher 会先按键查缓存, 再读取数据, 而旧版服务端在多次上传和不同服务器之间
    /// 对同一用户名使用同一个头像 URL.
    private static func cacheKey(for data: Data) -> String {
        "avatar-" + SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func load() async {
        failed = false
        guard let apiClient, let loaded = try? await apiClient.getData(path), UIImage(data: loaded) != nil else {
            data = nil
            failed = true
            return
        }
        data = loaded
    }
}

/// The avatar shown when there is no image: the username's initial, or a person glyph for the
/// anonymous user.
///
/// 没有头像图片时显示的内容: 用户名首字母, 匿名用户则显示人形图标.
private struct AvatarFallback: View {
    let username: String?
    let isAnonymous: Bool

    var body: some View {
        if isAnonymous {
            Image(systemName: "person.fill")
                .font(.title2)
                .foregroundStyle(.secondary)
        } else {
            Text(String(username?.prefix(1).uppercased() ?? "?"))
                .font(.title2.bold())
                .foregroundStyle(.tint)
        }
    }
}

/// Downloads settings: cellular use for the signed-in account, and the storage and deletion of
/// every download on the device, which is one library whatever server or account made it.
///
/// 下载设置: 已登录账号的蜂窝数据设置, 以及本机全部下载的存储占用与删除; 无论由哪个服务器或账号下载,
/// 它们都属于同一个下载库.
private struct DownloadsSettingsSection: View {
    let downloads: DownloadManager
    /// The signed-in account's scope; nil for the anonymous user, who cannot download.
    ///
    /// 已登录账号的作用域; 匿名用户为 nil, 无法下载.
    let scope: String?
    @State private var confirmDeleteAll = false

    var body: some View {
        let total = downloads.storage.activeBytes + downloads.storage.otherBytes
        if scope != nil || total > 0 {
            Section {
                if scope != nil {
                    Toggle("Allow downloads over cellular", isOn: Binding(
                        get: { downloads.allowsCellular },
                        set: { value in Task { await downloads.setAllowsCellular(value) } }))
                }
                LabeledContent("Storage used", value: DownloadFormatting.bytes(total))
                if total > 0 {
                    Button("Delete all downloads", role: .destructive) { confirmDeleteAll = true }
                }
            } header: {
                Text("Downloads")
            } footer: {
                Text("Downloads stay on this device and are not synced to other devices.")
            }
            .confirmationDialog("Delete every download on this device?", isPresented: $confirmDeleteAll,
                                titleVisibility: .visible) {
                Button("Delete", role: .destructive) { Task { await downloads.deleteAllDownloads() } }
            }
        }
    }
}
#endif
