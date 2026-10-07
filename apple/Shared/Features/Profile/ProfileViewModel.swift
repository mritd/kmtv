import Foundation
import os
import UIKit

@Observable
@MainActor
final class ProfileViewModel {
    var isEditingUsername = false
    var editUsername = ""
    var passwordOld = ""
    var passwordNew = ""
    var passwordConfirm = ""
    var isChangingPassword = false
    var successMessage: String?

    /// Protocol dependency keeps profile API behavior replaceable in unit tests.
    ///
    /// 使用协议依赖让个人资料 API 行为可以在单元测试中替换.
    private let apiClient: any ProfileAPIProtocol
    private let syncStore: SyncStore?
    private let toasts: any ToastPresenting
    private let logger = Logger(subsystem: "com.mritd.kmtv", category: "api")
    /// Weak app state bridge used to keep the global current user snapshot fresh.
    ///
    /// 弱引用应用状态桥接, 用于同步全局 current user 快照.
    private weak var appVM: AppViewModel?

    /// The signed-in user. With an app state bridge it is that state's `currentUser`, so there is one
    /// source of truth; without one (unit tests) the view model holds its own.
    ///
    /// 当前登录用户. 有应用状态桥接时直接读写其 `currentUser`, 保证只有一个数据源; 没有桥接
    /// (单元测试) 时由视图模型自己持有.
    var user: User? {
        get { appVM.map(\.currentUser) ?? standaloneUser }
        set {
            if let appVM { appVM.currentUser = newValue } else { standaloneUser = newValue }
        }
    }
    private var standaloneUser: User?

    /// `toasts` shows failures; successes go to `successMessage`.
    ///
    /// `toasts` 显示失败提示; 成功信息写入 `successMessage`.
    init(apiClient: any ProfileAPIProtocol, syncStore: SyncStore?, user: User?, appVM: AppViewModel? = nil,
         toasts: any ToastPresenting = ToastManager.shared) {
        self.apiClient = apiClient
        self.syncStore = syncStore
        self.standaloneUser = user
        self.appVM = appVM
        self.toasts = toasts
    }

    private func showError(_ error: Error) {
        toasts.show(error: error)
    }

    func updateUsername() async {
        let trimmed = editUsername.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        do {
            user = try await apiClient.updateProfile(username: trimmed)
            isEditingUsername = false
            successMessage = String(localized: "Username updated")
        } catch {
            logger.error("Update username failed: \(error.localizedDescription)")
            showError(error)
        }
    }

    func uploadAvatar(imageData: Data) async {
        // Re-encode selected images to JPEG to keep upload payload size predictable.
        //
        // 将选择的图片重新编码为 JPEG, 控制上传体积和格式.
        guard let uiImage = UIImage(data: imageData),
              let jpegData = uiImage.jpegData(compressionQuality: 0.8) else { return }
        do {
            user = try await apiClient.uploadAvatar(imageData: jpegData, mimeType: "image/jpeg")
            successMessage = String(localized: "Avatar updated")
        } catch {
            logger.error("Upload avatar failed: \(error.localizedDescription)")
            showError(error)
        }
    }

    func deleteAvatar() async {
        do {
            user = try await apiClient.deleteAvatar()
            successMessage = String(localized: "Avatar removed")
        } catch {
            logger.error("Delete avatar failed: \(error.localizedDescription)")
            showError(error)
        }
    }

    func changePassword() async {
        guard passwordNew == passwordConfirm else {
            toasts.show(String(localized: "Passwords don't match"))
            return
        }
        guard !passwordNew.isEmpty else {
            toasts.show(String(localized: "Password cannot be empty"))
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

    /// Loads the photo picked as the new avatar and uploads it; a photo that cannot be read is
    /// reported instead of failing silently.
    ///
    /// 读取选中的照片并上传为新头像; 无法读取的照片会提示, 而不是静默失败.
    func pickAvatar(loading load: () async throws -> Data?) async {
        guard let data = try? await load() else {
            toasts.show(String(localized: "Could not load the selected photo"))
            return
        }
        await uploadAvatar(imageData: data)
    }

    /// Clears watch history on every device of this account. Returns whether anything was cleared:
    /// without a store there is nothing to clear and no success is reported.
    ///
    /// 在该账号的所有设备上清空观看历史. 返回是否执行了清空: 没有同步存储时无事可做, 也不报告成功.
    @discardableResult
    static func clearWatchHistory(in store: SyncStore?) -> Bool {
        guard let store else { return false }
        store.clear(.watch)
        return true
    }

    /// Clears watch history through `clearWatchHistory(in:)` and reports success when it ran.
    ///
    /// 通过 `clearWatchHistory(in:)` 清空观看历史, 并在执行后报告成功.
    @discardableResult
    func clearWatchHistory() -> Bool {
        guard Self.clearWatchHistory(in: syncStore) else { return false }
        successMessage = String(localized: "Watch history cleared")
        return true
    }
}
