import Foundation

@Observable
@MainActor
final class AdminViewModel {
    var sources: [Source] = []
    var isCheckingAll = false
    var subscriptions: [Subscription] = []
    var users: [User] = []
    var settings: [String: String] = [:]
    var isLoading = false
    var error: String?
    var successMessage: String?
    var syncingSubId: Int?
    let currentUserId: Int

    /// Protocol dependency keeps admin API behavior replaceable in unit tests.
    /// 使用协议依赖让管理 API 行为可以在单元测试中替换.
    private let apiClient: any AdminAPIProtocol

    init(apiClient: any AdminAPIProtocol, currentUserId: Int) {
        self.apiClient = apiClient
        self.currentUserId = currentUserId
    }

    // MARK: - Sources

    func loadSources() async {
        do {
            sources = try await apiClient.listSources().sources
        } catch {
            self.error = error.localizedDescription
        }
    }

    func toggleSourceEnabled(_ source: Source) async {
        do {
            try await apiClient.updateSource(id: source.id, UpdateSourceRequest(enabled: !source.enabled))
            await loadSources()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func checkAllSources() async {
        isCheckingAll = true
        do {
            try await apiClient.checkAllSources()
            // Backend health checks are asynchronous, so wait briefly before reloading.
            // 后端健康检查是异步执行的, 因此短暂等待后再刷新列表.
            try? await Task.sleep(for: .seconds(5))
            await loadSources()
        } catch {
            self.error = error.localizedDescription
        }
        isCheckingAll = false
    }

    func deleteSource(_ source: Source) async {
        do {
            try await apiClient.deleteSource(id: source.id)
            await loadSources()
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Subscriptions

    func loadSubscriptions() async {
        do {
            subscriptions = try await apiClient.listSubscriptions().subscriptions
        } catch {
            self.error = error.localizedDescription
        }
    }

    func createSubscription(url: String, interval: Int, autoUpdate: Bool) async {
        do {
            _ = try await apiClient.createSubscription(CreateSubscriptionRequest(url: url, autoUpdate: autoUpdate, interval: interval))
            await loadSubscriptions()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func syncSubscription(_ sub: Subscription) async {
        syncingSubId = sub.id
        do {
            try await apiClient.syncSubscription(id: sub.id)
            successMessage = String(localized: "Sync completed")
            await loadSubscriptions()
        } catch {
            self.error = error.localizedDescription
        }
        syncingSubId = nil
    }

    func deleteSubscription(_ sub: Subscription) async {
        do {
            try await apiClient.deleteSubscription(id: sub.id)
            await loadSubscriptions()
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Users

    func loadUsers() async {
        do {
            users = try await apiClient.listUsers().users
        } catch {
            self.error = error.localizedDescription
        }
    }

    func createUser(username: String, password: String, role: String) async {
        do {
            _ = try await apiClient.createUser(CreateUserRequest(username: username, password: password, role: role))
            await loadUsers()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func deleteUser(_ user: User) async {
        guard user.id != currentUserId else {
            error = String(localized: "Cannot delete yourself")
            return
        }
        do {
            try await apiClient.deleteUser(id: user.id)
            await loadUsers()
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Settings

    func loadSettings() async {
        do {
            settings = try await apiClient.getSettings().settings
        } catch {
            self.error = error.localizedDescription
        }
    }

    func updateSetting(key: String, value: String) async {
        // Optimistically update local settings so the form reflects the user's choice immediately.
        // 先乐观更新本地设置, 让表单立即反映用户选择.
        settings[key] = value
        do {
            try await apiClient.updateSettings([key: value])
        } catch {
            self.error = error.localizedDescription
        }
    }
}
