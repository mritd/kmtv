import SwiftUI

struct AdminView: View {
    @Environment(AppViewModel.self) private var appVM
    @State private var viewModel: AdminViewModel?
    @State private var selectedTab = 0

    var body: some View {
        Group {
            if let viewModel {
                adminContent(viewModel)
            } else {
                ProgressView()
            }
        }
        .background(Theme.bgPrimary)
        .navigationTitle("Admin")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task {
            if viewModel == nil, let client = appVM.apiClient {
                let vm = AdminViewModel(apiClient: client, currentUserId: appVM.currentUser?.id ?? 0)
                viewModel = vm
                await vm.loadSources()
            }
        }
        .onChange(of: selectedTab) { _, newValue in
            guard let vm = viewModel else { return }
            Task {
                switch newValue {
                case 0: await vm.loadSources()
                case 1: await vm.loadSubscriptions()
                case 2: await vm.loadUsers()
                case 3: await vm.loadSettings()
                default: break
                }
            }
        }
    }

    @ViewBuilder
    private func adminContent(_ vm: AdminViewModel) -> some View {
        VStack(spacing: 0) {
            // Segmented picker instead of nested TabView.
            // 使用分段选择器替代嵌套 TabView, 避免平台导航层级互相干扰.
            Picker("", selection: $selectedTab) {
                Text("Sources").tag(0)
                Text("Subs").tag(1)
                Text("Users").tag(2)
                Text("Settings").tag(3)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.vertical, 8)

            Group {
                switch selectedTab {
                case 0: sourcesTab(vm)
                case 1: subscriptionsTab(vm)
                case 2: usersTab(vm)
                case 3: settingsTab(vm)
                default: EmptyView()
                }
            }
        }
        .alert("Error", isPresented: .init(get: { vm.error != nil }, set: { if !$0 { vm.error = nil } })) {
            Button("OK") { vm.error = nil }
        } message: {
            Text(vm.error ?? "")
        }
        .alert("OK", isPresented: .init(get: { vm.successMessage != nil }, set: { if !$0 { vm.successMessage = nil } })) {
            Button("OK") { vm.successMessage = nil }
        } message: {
            Text(vm.successMessage ?? "")
        }
    }

    // MARK: - Sources Tab

    /// Sort: normal sources first, adult sources below.
    /// 排序视频源: 普通源优先, 成人源靠后.
    private var sortedSources: [Source] {
        guard let vm = viewModel else { return [] }
        return vm.sources.sorted { a, b in
            let aAdult = a.name.contains("🔞")
            let bAdult = b.name.contains("🔞")
            if aAdult != bAdult { return !aAdult }
            return a.id < b.id
        }
    }

    @ViewBuilder
    private func sourcesTab(_ vm: AdminViewModel) -> some View {
        List {
            Section {
                HStack {
                    let healthy = vm.sources.filter { $0.health == "healthy" }.count
                    Text("Healthy: \(healthy)/\(vm.sources.count)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button {
                        Task { await vm.checkAllSources() }
                    } label: {
                        if vm.isCheckingAll {
                            ProgressView()
                        } else {
                            Text("Check All")
                        }
                    }
                    .disabled(vm.isCheckingAll)
                }
            }

            ForEach(sortedSources, id: \.id) { source in
                sourceRow(source, vm: vm)
            }
        }
    }

    @ViewBuilder
    private func sourceRow(_ source: Source, vm: AdminViewModel) -> some View {
        HStack {
            Circle()
                .fill(healthColor(source.health))
                .frame(width: 8, height: 8)
            VStack(alignment: .leading) {
                Text(source.name).font(.body)
                Text(source.key).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Toggle("", isOn: Binding(
                get: { source.enabled },
                set: { _ in Task { await vm.toggleSourceEnabled(source) } }
            ))
            .labelsHidden()
        }
    }

    // MARK: - Subscriptions Tab

    @State private var showAddSub = false
    @State private var newSubURL = ""
    @State private var newSubInterval = "86400"

    @ViewBuilder
    private func subscriptionsTab(_ vm: AdminViewModel) -> some View {
        List {
            Section {
                Button("Add Subscription") { showAddSub = true }
                    .listRowBackground(Theme.bgCard)
            }
            ForEach(vm.subscriptions, id: \.id) { sub in
                subscriptionRow(sub, vm: vm)
            }
            .onDelete { indexSet in
                let toDelete = indexSet.map { vm.subscriptions[$0] }
                Task {
                    for item in toDelete {
                        await vm.deleteSubscription(item)
                    }
                    await vm.loadSubscriptions()
                }
            }
        }
        .sheet(isPresented: $showAddSub) {
            addSubscriptionSheet(vm)
        }
    }

    @ViewBuilder
    private func subscriptionRow(_ sub: Subscription, vm: AdminViewModel) -> some View {
        HStack {
            VStack(alignment: .leading) {
                Text(sub.url).font(.caption).lineLimit(1)
                HStack(spacing: 4) {
                    Text(String(localized: "Interval (seconds)"))
                    Text("\(sub.interval)")
                    Text("|")
                    Text(String(localized: "Auto Sync"))
                    Text(sub.autoUpdate ? String(localized: "Yes") : String(localized: "No"))
                }
                .font(.caption2).foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                Task { await vm.syncSubscription(sub) }
            } label: {
                if vm.syncingSubId == sub.id {
                    ProgressView()
                        #if os(iOS)
                        .controlSize(.small)
                        #endif
                } else {
                    Text("Sync")
                }
            }
            .font(.caption)
            .disabled(vm.syncingSubId != nil)
        }
    }

    private var isSubURLInvalid: Bool {
        let trimmed = newSubURL.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return false }
        return !isValidHTTPURL(trimmed)
    }

    @ViewBuilder
    private func addSubscriptionSheet(_ vm: AdminViewModel) -> some View {
        NavigationStack {
            Form {
                Section(String(localized: "Subscription URL")) {
                    TextField("https://example.com/sub.json", text: $newSubURL)
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        #endif
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(Color.red, lineWidth: isSubURLInvalid ? 1.5 : 0)
                        )
                    if isSubURLInvalid {
                        Text(String(localized: "Invalid URL format, must start with http:// or https://"))
                            .font(.caption2)
                            .foregroundStyle(.red)
                    }
                }
                Section(String(localized: "Interval (seconds)")) {
                    TextField("86400", text: $newSubInterval)
                        #if os(iOS)
                        .keyboardType(.numberPad)
                        #endif
                }
            }
            .navigationTitle("Add Subscription")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { showAddSub = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        Task {
                            await vm.createSubscription(url: newSubURL, interval: Int(newSubInterval) ?? 86400, autoUpdate: true)
                            newSubURL = ""
                            showAddSub = false
                        }
                    }
                    .disabled(newSubURL.trimmingCharacters(in: .whitespaces).isEmpty || isSubURLInvalid)
                }
            }
        }
    }

    // MARK: - Users Tab

    @State private var showAddUser = false
    @State private var newUserName = ""
    @State private var newUserPassword = ""
    @State private var newUserConfirmPassword = ""
    @State private var newUserRole = "user"

    @ViewBuilder
    private func usersTab(_ vm: AdminViewModel) -> some View {
        List {
            Section {
                Button("Add User") { showAddUser = true }
                    .listRowBackground(Theme.bgCard)
            }
            ForEach(vm.users, id: \.id) { user in
                userRow(user, vm: vm)
            }
            .onDelete { indexSet in
                let toDelete = indexSet.map { vm.users[$0] }
                if toDelete.contains(where: { $0.id == vm.currentUserId }) {
                    vm.error = String(localized: "Cannot delete yourself")
                    return
                }
                Task {
                    for user in toDelete {
                        await vm.deleteUser(user)
                    }
                    await vm.loadUsers()
                }
            }
        }
        .sheet(isPresented: $showAddUser) {
            addUserSheet(vm)
        }
    }

    @ViewBuilder
    private func userRow(_ user: User, vm: AdminViewModel) -> some View {
        HStack {
            Text(user.username)
            Spacer()
            Text(user.role == "admin" ? String(localized: "Admin") : String(localized: "Regular User"))
                .font(.caption)
                .foregroundStyle(user.role == "admin" ? Color.orange : Color.green)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(user.role == "admin" ? Color.orange.opacity(0.2) : Color.green.opacity(0.2))
                .clipShape(Capsule())
        }
        .deleteDisabled(user.id == vm.currentUserId)
    }

    private var passwordsMatch: Bool {
        !newUserPassword.isEmpty && newUserPassword == newUserConfirmPassword
    }

    @ViewBuilder
    private func addUserSheet(_ vm: AdminViewModel) -> some View {
        NavigationStack {
            Form {
                TextField("Username", text: $newUserName)
                SecureField("Password", text: $newUserPassword)
                SecureField("Confirm Password", text: $newUserConfirmPassword)
                if !newUserConfirmPassword.isEmpty && !passwordsMatch {
                    Text("Passwords do not match")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
                Picker("Role", selection: $newUserRole) {
                    Text("Regular User").tag("user")
                    Text("Admin").tag("admin")
                }
            }
            .navigationTitle("Add User")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { showAddUser = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        Task {
                            await vm.createUser(username: newUserName, password: newUserPassword, role: newUserRole)
                            newUserName = ""
                            newUserPassword = ""
                            newUserConfirmPassword = ""
                            showAddUser = false
                        }
                    }
                    .disabled(newUserName.trimmingCharacters(in: .whitespaces).isEmpty || newUserPassword.trimmingCharacters(in: .whitespaces).isEmpty || !passwordsMatch)
                }
            }
        }
    }

    // MARK: - Settings Tab

    @ViewBuilder
    private func settingsTab(_ vm: AdminViewModel) -> some View {
        List {
            Section {
                Toggle("Anonymous Access", isOn: settingBinding(vm, key: "anonymous_access"))
                Toggle("Adult Filter", isOn: settingBinding(vm, key: "adult_filter_enabled"))
            }
            Section {
                Picker("Access Token TTL", selection: ttlBinding(vm, key: "access_token_ttl", defaultValue: "604800")) {
                    Text("7 Days").tag("604800")
                    Text("30 Days").tag("2592000")
                    Text("365 Days").tag("31536000")
                }
                Picker("Media Token TTL", selection: ttlBinding(vm, key: "media_token_ttl", defaultValue: "1800")) {
                    Text("15 Minutes").tag("900")
                    Text("30 Minutes").tag("1800")
                    Text("60 Minutes").tag("3600")
                    Text("120 Minutes").tag("7200")
                }
                Picker("Playback Mode", selection: playbackModeBinding(vm)) {
                    Text("Backend Proxy").tag("proxy")
                    Text("Client Direct").tag("direct")
                }
                Picker("Image Proxy", selection: imageProxyBinding(vm)) {
                    Text("Backend Proxy").tag("server")
                    Text("Client Direct").tag("direct")
                    Text("Tencent CDN").tag("tencent")
                    Text("Ali CDN").tag("ali")
                }
            }
            Section(header: Text(String(localized: "Performance"))) {
                NumericSettingField(
                    label: String(localized: "Search Concurrency"),
                    value: vm.settings["search_concurrency"] ?? "",
                    placeholder: "20",
                    range: 1...50
                ) { await vm.updateSetting(key: "search_concurrency", value: $0) }
                NumericSettingField(
                    label: String(localized: "Search Timeout"),
                    value: vm.settings["search_timeout"] ?? "",
                    placeholder: "10",
                    range: 1...30,
                    suffix: "s"
                ) { await vm.updateSetting(key: "search_timeout", value: $0) }
                NumericSettingField(
                    label: String(localized: "Probe Concurrency"),
                    value: vm.settings["probe_concurrency"] ?? "",
                    placeholder: "20",
                    range: 1...50
                ) { await vm.updateSetting(key: "probe_concurrency", value: $0) }
                NumericSettingField(
                    label: String(localized: "Probe Timeout"),
                    value: vm.settings["probe_timeout"] ?? "",
                    placeholder: "3",
                    range: 1...20,
                    suffix: "s"
                ) { await vm.updateSetting(key: "probe_timeout", value: $0) }
            }
        }
    }

    // MARK: - Helpers

    private func healthColor(_ health: String) -> Color {
        switch health {
        case "healthy": return .green
        case "unhealthy": return .red
        default: return .gray
        }
    }

    private func settingBinding(_ vm: AdminViewModel, key: String) -> Binding<Bool> {
        Binding(
            get: { vm.settings[key] == "true" },
            set: { newValue in
                let newStr = newValue ? "true" : "false"
                guard vm.settings[key] != newStr else { return }
                Task { await vm.updateSetting(key: key, value: newStr) }
            }
        )
    }

    private func settingTextBinding(_ vm: AdminViewModel, key: String) -> Binding<String> {
        Binding(
            get: { vm.settings[key] ?? "" },
            set: { vm.settings[key] = $0 }
        )
    }

    private func imageProxyBinding(_ vm: AdminViewModel) -> Binding<String> {
        Binding(
            get: {
                let val = vm.settings["douban_image_proxy"] ?? ""
                return val.isEmpty ? "server" : val
            },
            set: { newValue in
                let current = vm.settings["douban_image_proxy"] ?? ""
                let effective = current.isEmpty ? "server" : current
                guard newValue != effective else { return }
                Task { await vm.updateSetting(key: "douban_image_proxy", value: newValue) }
            }
        )
    }

    /// Builds a picker binding for TTL settings stored as seconds.
    /// 为以秒为单位保存的 TTL 设置构建 Picker binding.
    private func ttlBinding(_ vm: AdminViewModel, key: String, defaultValue: String) -> Binding<String> {
        Binding(
            get: {
                let val = vm.settings[key] ?? ""
                return val.isEmpty ? defaultValue : val
            },
            set: { newValue in
                let current = vm.settings[key] ?? ""
                let effective = current.isEmpty ? defaultValue : current
                guard newValue != effective else { return }
                Task { await vm.updateSetting(key: key, value: newValue) }
            }
        )
    }

    /// Keeps playback mode aligned with backend values: proxy or direct.
    /// 让播放模式与后端取值保持一致: proxy 或 direct.
    private func playbackModeBinding(_ vm: AdminViewModel) -> Binding<String> {
        Binding(
            get: {
                let val = vm.settings["playback_mode"] ?? ""
                return val.isEmpty ? "proxy" : val
            },
            set: { newValue in
                let current = vm.settings["playback_mode"] ?? ""
                let effective = current.isEmpty ? "proxy" : current
                guard newValue != effective else { return }
                Task { await vm.updateSetting(key: "playback_mode", value: newValue) }
            }
        )
    }
}

/// A numeric text field that only commits on Enter or focus loss.
/// 仅在回车或失焦时提交的数字输入框.
private struct NumericSettingField: View {
    let label: String
    let value: String
    let placeholder: String
    let range: ClosedRange<Int>
    var suffix: String? = nil
    let onCommit: (String) async -> Void

    @State private var draft: String = ""
    @FocusState private var isFocused: Bool

    var body: some View {
        HStack {
            Text(label)
            Spacer()
            HStack(spacing: 2) {
                TextField(placeholder, text: $draft)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .focused($isFocused)
                    .onSubmit { commit() }
                    .onChange(of: isFocused) { _, focused in
                        if !focused { commit() }
                    }
                Text(suffix ?? " ")
                    .foregroundStyle(.secondary)
            }
            .frame(width: 80, alignment: .trailing)
        }
        .onAppear { draft = value.isEmpty ? placeholder : value }
        .onChange(of: value) { _, newValue in
            if !isFocused { draft = newValue.isEmpty ? placeholder : newValue }
        }
    }

    private func commit() {
        let filtered = draft.filter { $0.isNumber }
        let defaultVal = Int(placeholder) ?? range.lowerBound
        let n = min(max(Int(filtered) ?? defaultVal, range.lowerBound), range.upperBound)
        let clamped = String(n)
        draft = clamped
        let current = value.isEmpty ? placeholder : value
        guard clamped != current else { return }
        Task { await onCommit(clamped) }
    }
}
