#if os(iOS)
import SwiftUI

/// The admin subscriptions tab: the list with sync and swipe-to-delete, and the add sheet.
///
/// 管理页的订阅标签页: 支持同步与滑动删除的列表, 以及添加表单.
struct AdminSubscriptionsTab: View {
    let vm: AdminViewModel
    @State private var showAddSub = false

    var body: some View {
        List {
            Section {
                Button("Add Subscription") {
                    vm.createError = nil
                    showAddSub = true
                }
            }
            ForEach(vm.subscriptions, id: \.id) { sub in
                subscriptionRow(sub)
            }
            .onDelete { indexSet in
                let toDelete = indexSet.map { vm.subscriptions[$0] }
                Task { await vm.deleteSubscriptions(toDelete) }
            }
        }
        .sheet(isPresented: $showAddSub) {
            AddSubscriptionSheet(vm: vm)
        }
    }

    @ViewBuilder
    private func subscriptionRow(_ sub: Subscription) -> some View {
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
}

/// The add-subscription form. It owns its input, which stays while a failed request shows its
/// error inside the sheet.
///
/// 添加订阅的表单. 表单持有自己的输入; 请求失败时错误显示在表单内, 输入保持不变.
private struct AddSubscriptionSheet: View {
    let vm: AdminViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var url = ""
    @State private var interval = "86400"
    @State private var isSubmitting = false

    private var isURLInvalid: Bool {
        let trimmed = url.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return false }
        return !isValidHTTPURL(trimmed)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(String(localized: "Subscription URL")) {
                    TextField("https://example.com/sub.json", text: $url)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .fieldSurface(invalid: isURLInvalid)
                    if isURLInvalid {
                        Text(String(localized: "Invalid URL format, must start with http:// or https://"))
                            .font(AppFont.meta)
                            .foregroundStyle(StatusColor.danger)
                    }
                }
                if let createError = vm.createError {
                    Section { Text(createError).font(AppFont.footnote).foregroundStyle(StatusColor.danger) }
                }
                Section(String(localized: "Interval (seconds)")) {
                    TextField("86400", text: $interval)
                        .keyboardType(.numberPad)
                }
            }
            .navigationTitle("Add Subscription")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        isSubmitting = true
                        Task {
                            // Keep the sheet and its input when the request fails; the error shows inside it.
                            //
                            // 请求失败时保留表单及其输入, 错误显示在表单内.
                            if await vm.createSubscription(url: url, interval: Int(interval) ?? 86400, autoUpdate: true) {
                                dismiss()
                            }
                            isSubmitting = false
                        }
                    }
                    .disabled(isSubmitting || url.trimmingCharacters(in: .whitespaces).isEmpty || isURLInvalid)
                }
            }
        }
    }
}
#endif
