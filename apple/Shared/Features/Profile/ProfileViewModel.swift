import Foundation
import os
import SwiftData
import UIKit

@Observable
@MainActor
final class ProfileViewModel {
    var user: User?
    var watchHistoryCount = 0
    var isEditingUsername = false
    var editUsername = ""
    var passwordOld = ""
    var passwordNew = ""
    var passwordConfirm = ""
    var isChangingPassword = false
    var successMessage: String?

    /// Protocol dependency keeps profile API behavior replaceable in unit tests.
    /// 使用协议依赖让个人资料 API 行为可以在单元测试中替换.
    private let apiClient: any AuthAPIProtocol
    private let modelContext: ModelContext
    private let serverURL: String
    private let logger = Logger(subsystem: "com.mritd.kmtv", category: "api")
    /// Weak app state bridge used to keep the global current user snapshot fresh.
    /// 弱引用应用状态桥接, 用于同步全局 current user 快照.
    private weak var appVM: AppViewModel?

    init(apiClient: any AuthAPIProtocol, modelContext: ModelContext, serverURL: String, user: User?, appVM: AppViewModel? = nil) {
        self.apiClient = apiClient
        self.modelContext = modelContext
        self.serverURL = serverURL
        self.user = user
        self.appVM = appVM
    }

    private func showError(_ error: Error) {
        // Centralize profile errors so APIError localized messages stay consistent.
        // 集中处理个人资料错误, 保持 APIError 本地化提示一致.
        if let apiError = error as? APIError {
            ToastManager.shared.show(apiError.localizedMessage)
        } else {
            ToastManager.shared.show(error.localizedDescription)
        }
    }

    func load() {
        // The profile screen only needs a count, so avoid loading full history rows.
        // 个人资料页只需要数量, 避免加载完整观看历史记录.
        let serverURL = self.serverURL
        let descriptor = FetchDescriptor<WatchHistoryItem>(predicate: #Predicate { $0.serverURL == serverURL })
        watchHistoryCount = (try? modelContext.fetchCount(descriptor)) ?? 0
    }

    func updateUsername() async {
        let trimmed = editUsername.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        do {
            user = try await apiClient.updateProfile(username: trimmed)
            // Keep local profile state and app-wide user state aligned after mutation.
            // 修改用户名后同时同步个人资料状态和全局用户状态.
            appVM?.currentUser = user
            isEditingUsername = false
            successMessage = String(localized: "Username updated")
        } catch {
            logger.error("Update username failed: \(error.localizedDescription)")
            showError(error)
        }
    }

    func uploadAvatar(imageData: Data) async {
        // Re-encode selected images to JPEG to keep upload payload size predictable.
        // 将选择的图片重新编码为 JPEG, 控制上传体积和格式.
        guard let uiImage = UIImage(data: imageData),
              let jpegData = uiImage.jpegData(compressionQuality: 0.8) else { return }
        do {
            user = try await apiClient.uploadAvatar(imageData: jpegData, mimeType: "image/jpeg")
            // Avatar changes must also refresh appVM.currentUser for other screens.
            // 头像变更也需要刷新 appVM.currentUser, 让其他页面立即看到新头像.
            appVM?.currentUser = user
            successMessage = String(localized: "Avatar updated")
        } catch {
            logger.error("Upload avatar failed: \(error.localizedDescription)")
            showError(error)
        }
    }

    func deleteAvatar() async {
        do {
            user = try await apiClient.deleteAvatar()
            appVM?.currentUser = user
            successMessage = String(localized: "Avatar removed")
        } catch {
            logger.error("Delete avatar failed: \(error.localizedDescription)")
            showError(error)
        }
    }

    func changePassword() async {
        guard passwordNew == passwordConfirm else {
            ToastManager.shared.show(String(localized: "Passwords don't match"))
            return
        }
        guard !passwordNew.isEmpty else {
            ToastManager.shared.show(String(localized: "Password cannot be empty"))
            return
        }
        do {
            try await apiClient.changePassword(oldPassword: passwordOld, newPassword: passwordNew)
            passwordOld = ""
            passwordNew = ""
            passwordConfirm = ""
            isChangingPassword = false
            successMessage = String(localized: "Password changed")
        } catch {
            logger.error("Change password failed: \(error.localizedDescription)")
            showError(error)
        }
    }

    func clearWatchHistory() {
        // Clear only the current server's local history, not other saved servers.
        // 只清理当前服务器的本地观看历史, 不影响其他已保存服务器.
        WatchHistoryItem.clearAll(in: modelContext, serverURL: serverURL)
        try? modelContext.save()
        watchHistoryCount = 0
        successMessage = String(localized: "Watch history cleared")
    }
}
