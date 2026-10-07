#if os(iOS)
import SwiftUI

/// The admin users tab: the list with role and NSFW badges, swipe-to-delete, and the add sheet.
///
/// 管理页的用户标签页: 带角色与 NSFW 标记的列表, 滑动删除, 以及添加表单.
struct AdminUsersTab: View {
    let vm: AdminViewModel
    @State private var showAddUser = false

    var body: some View {
        List {
            Section {
                Button("Add User") {
                    vm.createError = nil
                    showAddUser = true
                }
            }
            ForEach(vm.users, id: \.id) { user in
                userRow(user)
            }
            .onDelete { indexSet in
                let toDelete = indexSet.map { vm.users[$0] }
                Task { await vm.deleteUsers(toDelete) }
            }
        }
        .sheet(isPresented: $showAddUser) {
            AddUserSheet(vm: vm)
        }
    }

    @ViewBuilder
    private func userRow(_ user: User) -> some View {
        HStack {
            Text(user.username)
            Spacer()
            if user.allowAdultContent {
                NSFWBadge()
            }
            RoleBadge(user: user)
        }
        .deleteDisabled(user.id == vm.currentUserId)
    }
}

/// The add-user form. It owns its input, which stays while a failed request shows its error
/// inside the sheet.
///
/// 添加用户的表单. 表单持有自己的输入; 请求失败时错误显示在表单内, 输入保持不变.
private struct AddUserSheet: View {
    let vm: AdminViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var username = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var role = "user"
    @State private var allowAdultContent = false
    @State private var isSubmitting = false

    private var passwordsMatch: Bool {
        !password.isEmpty && password == confirmPassword
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("Username", text: $username)
                SecureField("Password", text: $password)
                SecureField("Confirm Password", text: $confirmPassword)
                if !confirmPassword.isEmpty && !passwordsMatch {
                    Text("Passwords do not match")
                        .font(AppFont.footnote)
                        .foregroundStyle(StatusColor.danger)
                }
                Picker("Role", selection: $role) {
                    Text("Regular User").tag("user")
                    Text("Admin").tag("admin")
                }
                Toggle("Allow NSFW Content", isOn: $allowAdultContent)
                if let createError = vm.createError {
                    Text(createError).font(AppFont.footnote).foregroundStyle(StatusColor.danger)
                }
            }
            .navigationTitle("Add User")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        isSubmitting = true
                        Task {
                            // Keep the sheet and its input when the request fails; the error shows inside it.
                            //
                            // 请求失败时保留表单及其输入, 错误显示在表单内.
                            if await vm.createUser(
                                username: username,
                                password: password,
                                role: role,
                                allowAdultContent: allowAdultContent
                            ) {
                                dismiss()
                            }
                            isSubmitting = false
                        }
                    }
                    .disabled(isSubmitting || username.trimmingCharacters(in: .whitespaces).isEmpty
                              || password.trimmingCharacters(in: .whitespaces).isEmpty || !passwordsMatch)
                }
            }
        }
    }
}
#endif
