#if os(iOS)
import SwiftUI

/// The sections of the admin screen.
///
/// 管理页面的各个分区.
enum AdminTab: CaseIterable, Hashable {
    case sources, subscriptions, users, settings

    var title: LocalizedStringKey {
        switch self {
        case .sources: "Sources"
        case .subscriptions: "Subs"
        case .users: "Users"
        case .settings: "Settings"
        }
    }
}

struct AdminView: View {
    @Environment(AppViewModel.self) private var appVM
    @Environment(\.appTheme) private var theme
    @State private var viewModel: AdminViewModel?
    @State private var selectedTab = AdminTab.sources

    var body: some View {
        Group {
            if let viewModel {
                adminContent(viewModel)
            } else {
                ProgressView()
            }
        }
        .readableColumn()
        .navigationTitle("Admin")
        .navigationBarTitleDisplayMode(.inline)
        // Also loads the first tab; a quick tab switch cancels the previous tab's load.
        //
        // 同时负责首个标签页的加载; 快速切换标签页会取消上一个标签页的加载.
        .task(id: selectedTab) {
            if viewModel == nil, let client = appVM.apiClient {
                viewModel = AdminViewModel(apiClient: client, currentUserId: appVM.currentUser?.id ?? 0)
            }
            guard let vm = viewModel else { return }
            switch selectedTab {
            case .sources: await vm.loadSources()
            case .subscriptions: await vm.loadSubscriptions()
            case .users: await vm.loadUsers()
            case .settings: await vm.loadSettings()
            }
        }
    }

    @ViewBuilder
    private func adminContent(_ vm: AdminViewModel) -> some View {
        VStack(spacing: 0) {
            // Segmented picker instead of nested TabView.
            //
            // 使用分段选择器替代嵌套 TabView, 避免平台导航层级互相干扰.
            Picker("", selection: $selectedTab) {
                ForEach(AdminTab.allCases, id: \.self) { tab in
                    Text(tab.title).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            // As wide as the lists' readable column on iPad.
            //
            // 在 iPad 上与列表的可读栏同宽.
            .frame(maxWidth: PageLayout.readableWidth)
            .padding(.horizontal, Spacing.page)
            .padding(.vertical, Spacing.sm)

            Group {
                switch selectedTab {
                case .sources: sourcesTab(vm)
                case .subscriptions: subscriptionsTab(vm)
                case .users: usersTab(vm)
                case .settings: settingsTab(vm)
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
    ///
    /// 排序视频源: 普通源优先, 成人源靠后.
    private var sortedSources: [Source] {
        guard let vm = viewModel else { return [] }
        return vm.sources.sorted { a, b in
            if a.isAdult != b.isAdult { return !a.isAdult }
            return a.id < b.id
        }
    }

    @ViewBuilder
    private func sourcesTab(_ vm: AdminViewModel) -> some View {
        List {
            Section {
                ForEach(sortedSources, id: \.id) { source in
                    sourceRow(source, vm: vm)
                }
            } header: {
                HStack {
                    let healthy = vm.sources.filter { $0.health == "healthy" }.count
                    Text("Healthy: \(healthy)/\(vm.sources.count)")
                        .monospacedDigit()
                    Spacer()
                    Button {
                        Task { await vm.checkAllSources() }
                    } label: {
                        if vm.isCheckingAll {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("Check All")
                        }
                    }
                    .font(AppFont.footnote.weight(.semibold))
                    .disabled(vm.isCheckingAll)
                }
                .textCase(nil)
            }
        }
    }

    @ViewBuilder
    private func sourceRow(_ source: Source, vm: AdminViewModel) -> some View {
        HStack {
            Circle()
                .fill(healthColor(source.health))
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                HStack(spacing: 6) {
                    Text(source.name).font(AppFont.body).lineLimit(1)
                    if source.isAdult {
                        Text("NSFW")
                            .font(AppFont.meta.weight(.semibold))
                            .foregroundStyle(.red)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.red.opacity(0.15))
                            .clipShape(Capsule())
                    }
                }
                Text(source.key).font(AppFont.footnote).foregroundStyle(.secondary)
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
    @State private var isSubmitting = false

    @ViewBuilder
    private func subscriptionsTab(_ vm: AdminViewModel) -> some View {
        List {
            Section {
                Button("Add Subscription") {
                    vm.createError = nil
                    showAddSub = true
                }
            }
            ForEach(vm.subscriptions, id: \.id) { sub in
                subscriptionRow(sub, vm: vm)
            }
            .onDelete { indexSet in
                let toDelete = indexSet.map { vm.subscriptions[$0] }
                Task { await vm.deleteSubscriptions(toDelete) }
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
                Text(sub.url).font(AppFont.footnote).lineLimit(1)
                HStack(spacing: 4) {
                    Text(String(localized: "Interval (seconds)"))
                    Text("\(sub.interval)")
                    Text("|")
                    Text(String(localized: "Auto Sync"))
                    Text(sub.autoUpdate ? String(localized: "Yes") : String(localized: "No"))
                }
                .font(AppFont.meta).foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                Task { await vm.syncSubscription(sub) }
            } label: {
                if vm.syncingSubId == sub.id {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Text("Sync")
                }
            }
            .font(AppFont.footnote)
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
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .fieldSurface(invalid: isSubURLInvalid)
                    if isSubURLInvalid {
                        Text(String(localized: "Invalid URL format, must start with http:// or https://"))
                            .font(AppFont.meta)
                            .foregroundStyle(.red)
                    }
                }
                if let createError = vm.createError {
                    Section { Text(createError).font(AppFont.footnote).foregroundStyle(.red) }
                }
                Section(String(localized: "Interval (seconds)")) {
                    TextField("86400", text: $newSubInterval)
                        .keyboardType(.numberPad)
                }
            }
            .navigationTitle("Add Subscription")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { showAddSub = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        isSubmitting = true
                        Task {
                            // Keep the sheet and its input when the request fails; the error shows inside it.
                            //
                            // 请求失败时保留表单及其输入, 错误显示在表单内.
                            if await vm.createSubscription(url: newSubURL, interval: Int(newSubInterval) ?? 86400, autoUpdate: true) {
                                newSubURL = ""
                                showAddSub = false
                            }
                            isSubmitting = false
                        }
                    }
                    .disabled(isSubmitting || newSubURL.trimmingCharacters(in: .whitespaces).isEmpty || isSubURLInvalid)
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
    @State private var newUserAllowAdultContent = false

    @ViewBuilder
    private func usersTab(_ vm: AdminViewModel) -> some View {
        List {
            Section {
                Button("Add User") {
                    vm.createError = nil
                    showAddUser = true
                }
            }
            ForEach(vm.users, id: \.id) { user in
                userRow(user, vm: vm)
            }
            .onDelete { indexSet in
                let toDelete = indexSet.map { vm.users[$0] }
                Task { await vm.deleteUsers(toDelete) }
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
            if user.allowAdultContent {
                Text("NSFW")
                    .font(AppFont.footnote)
                    .foregroundStyle(Color.red)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Color.red.opacity(0.2))
                    .clipShape(Capsule())
            }
            Text(user.roleDisplayName)
                .font(AppFont.footnote)
                .foregroundStyle(user.isAdmin ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(user.isAdmin ? theme.accentTint : Surface.fill)
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
                        .font(AppFont.footnote)
                        .foregroundStyle(.red)
                }
                Picker("Role", selection: $newUserRole) {
                    Text("Regular User").tag("user")
                    Text("Admin").tag("admin")
                }
                Toggle("Allow NSFW Content", isOn: $newUserAllowAdultContent)
                if let createError = vm.createError {
                    Text(createError).font(AppFont.footnote).foregroundStyle(.red)
                }
            }
            .navigationTitle("Add User")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { showAddUser = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        isSubmitting = true
                        Task {
                            // Keep the sheet and its input when the request fails; the error shows inside it.
                            //
                            // 请求失败时保留表单及其输入, 错误显示在表单内.
                            if await vm.createUser(
                                username: newUserName,
                                password: newUserPassword,
                                role: newUserRole,
                                allowAdultContent: newUserAllowAdultContent
                            ) {
                                newUserName = ""
                                newUserPassword = ""
                                newUserConfirmPassword = ""
                                newUserAllowAdultContent = false
                                showAddUser = false
                            }
                            isSubmitting = false
                        }
                    }
                    .disabled(isSubmitting || newUserName.trimmingCharacters(in: .whitespaces).isEmpty || newUserPassword.trimmingCharacters(in: .whitespaces).isEmpty || !passwordsMatch)
                }
            }
        }
    }

    // MARK: - Settings Tab

    @ViewBuilder
    private func settingsTab(_ vm: AdminViewModel) -> some View {
        List {
            Section {
                Toggle("Anonymous Access", isOn: boolSetting(vm, .anonymousAccess))
                Toggle("NSFW Filter", isOn: boolSetting(vm, .nsfwFilter))
                Toggle("Ad Filter", isOn: boolSetting(vm, .adFilter))
            }
            Section {
                ttlPicker("Access Token TTL", vm, key: .accessTokenTTL, presets: [604_800, 2_592_000, 31_536_000])
                ttlPicker("Media Token TTL", vm, key: .mediaTokenTTL, presets: [1_800, 3_600, 21_600, 43_200, 86_400])
                Picker("Playback Mode", selection: stringSetting(vm, .playbackMode)) {
                    Text("Backend Proxy").tag("proxy")
                    Text("Client Direct").tag("direct")
                }
                Picker("Image Proxy", selection: stringSetting(vm, .imageProxy)) {
                    Text("Backend Proxy").tag("server")
                    Text("Client Direct").tag("direct")
                    Text("Tencent CDN").tag("tencent")
                    Text("Ali CDN").tag("ali")
                }
            }
            Section(header: Text(String(localized: "Performance"))) {
                numericField(vm, .searchConcurrency, String(localized: "Search Concurrency"), range: 1...50)
                numericField(vm, .searchTimeout, String(localized: "Search Timeout"), range: 1...30, suffix: "s")
                numericField(vm, .probeConcurrency, String(localized: "Probe Concurrency"), range: 1...50)
                numericField(vm, .probeTimeout, String(localized: "Probe Timeout"), range: 1...20, suffix: "s")
            }
        }
    }

    private func numericField(_ vm: AdminViewModel, _ key: AdminViewModel.SettingKey, _ label: String,
                              range: ClosedRange<Int>, suffix: String? = nil) -> some View {
        NumericSettingField(
            label: label,
            value: vm.settings[key.rawValue] ?? "",
            placeholder: key.defaultValue,
            range: range,
            suffix: suffix
        ) { await vm.updateSetting(key: key.rawValue, value: $0) }
    }

    // MARK: - Helpers

    private func healthColor(_ health: String) -> Color {
        switch health {
        case "healthy": return .green
        case "unhealthy": return .red
        default: return .gray
        }
    }

    private func boolSetting(_ vm: AdminViewModel, _ key: AdminViewModel.SettingKey) -> Binding<Bool> {
        Binding(
            get: { vm.value(of: key) == "true" },
            set: { newValue in Task { await vm.setValue(newValue ? "true" : "false", for: key) } }
        )
    }

    /// A binding to a string setting; it reads the key's default while the server has no value and
    /// saves only a changed value.
    ///
    /// 字符串设置的绑定; 服务端没有值时读取该键的默认值, 并且只保存发生变化的值.
    private func stringSetting(_ vm: AdminViewModel, _ key: AdminViewModel.SettingKey) -> Binding<String> {
        Binding(
            get: { vm.value(of: key) },
            set: { newValue in Task { await vm.setValue(newValue, for: key) } }
        )
    }

    /// A TTL picker over `presets`, in seconds. A stored value outside the presets (the Web admin
    /// accepts any number of seconds) is listed too, so the picker never shows an empty selection.
    ///
    /// 以秒为单位, 在 `presets` 中选择有效期的选择器. 不在预设中的已存值 (Web 管理端允许任意秒数)
    /// 也会列出, 因此选择器不会显示空白.
    private func ttlPicker(_ title: LocalizedStringKey, _ vm: AdminViewModel, key: AdminViewModel.SettingKey,
                           presets: [Int]) -> some View {
        let selection = stringSetting(vm, key)
        let current = Int(selection.wrappedValue)
        let options = presets + (current.map { presets.contains($0) || $0 <= 0 ? [] : [$0] } ?? [])
        return Picker(title, selection: selection) {
            ForEach(options.sorted(), id: \.self) { seconds in
                Text(Duration.seconds(seconds).formatted(.units(allowed: [.days, .hours, .minutes], width: .wide)))
                    .tag(String(seconds))
            }
        }
    }
}

/// A numeric text field that only commits on Enter or focus loss.
///
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
#endif
