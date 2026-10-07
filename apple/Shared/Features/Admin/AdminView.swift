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
                case .sources: AdminSourcesTab(vm: vm)
                case .subscriptions: AdminSubscriptionsTab(vm: vm)
                case .users: AdminUsersTab(vm: vm)
                case .settings: AdminSettingsTab(vm: vm)
                }
            }
        }
        .alert("Error", isPresented: .init(get: { vm.error != nil }, set: { if !$0 { vm.error = nil } })) {
            Button("OK") { vm.error = nil }
        } message: {
            Text(verbatim: vm.error ?? "")
        }
        .alert("OK", isPresented: .init(get: { vm.successMessage != nil }, set: { if !$0 { vm.successMessage = nil } })) {
            Button("OK") { vm.successMessage = nil }
        } message: {
            Text(verbatim: vm.successMessage ?? "")
        }
    }
}
#endif
