import Foundation

@Observable
@MainActor
final class AdminViewModel {
    var sources: [Source] = []
    var isCheckingAll = false
    var subscriptions: [Subscription] = []
    var users: [User] = []
    var settings: [String: String] = [:]
    var error: String?
    /// The last failed create request, shown inside the open add sheet so the typed input survives.
    ///
    /// 最近一次失败的创建请求, 显示在仍打开的添加表单内, 以保留已输入的内容.
    var createError: String?
    var successMessage: String?
    var syncingSubId: Int?
    let currentUserId: Int

    /// The server settings this screen edits, with the value shown while the server has none.
    ///
    /// 此页面编辑的服务端设置, 以及服务端没有值时显示的默认值.
    enum SettingKey: String {
        case anonymousAccess = "anonymous_access"
        case nsfwFilter = "nsfw_filter_enabled"
        case adFilter = "ad_filter_enabled"
        case accessTokenTTL = "access_token_ttl"
        case mediaTokenTTL = "media_token_ttl"
        case playbackMode = "playback_mode"
        case imageProxy = "douban_image_proxy"
        case searchConcurrency = "search_concurrency"
        case searchTimeout = "search_timeout"
        case probeConcurrency = "probe_concurrency"
        case probeTimeout = "probe_timeout"

        /// The value used when the server has none for this key.
        ///
        /// 服务端没有该键的值时使用的默认值.
        var defaultValue: String {
            switch self {
            case .anonymousAccess, .nsfwFilter, .adFilter: "false"
            case .accessTokenTTL: "604800"
            case .mediaTokenTTL: "21600"
            case .playbackMode: "proxy"
            case .imageProxy: "server"
            case .searchConcurrency, .probeConcurrency: "20"
            case .searchTimeout: "10"
            case .probeTimeout: "3"
            }
        }
    }

    /// Protocol dependency keeps admin API behavior replaceable in unit tests.
    ///
    /// 使用协议依赖让管理 API 行为可以在单元测试中替换.
    private let apiClient: any AdminAPIProtocol

    init(apiClient: any AdminAPIProtocol, currentUserId: Int) {
        self.apiClient = apiClient
        self.currentUserId = currentUserId
    }

    /// Surfaces a failure unless the request was cancelled, as a tab switch cancels its load.
    ///
    /// 展示失败信息; 请求被取消 (例如切换标签页会取消加载) 时不展示.
    private func report(_ error: Error) {
        guard !Task.isCancelled else { return }
        self.error = error.localizedDescription
    }

    // MARK: - Sources

    func loadSources() async {
        do {
            sources = try await apiClient.listSources().sources
        } catch {
            report(error)
        }
    }

    func toggleSourceEnabled(_ source: Source) async {
        do {
            try await apiClient.updateSource(
                id: source.id,
                UpdateSourceRequest(
                    name: source.name,
                    api: source.api,
                    detail: source.detail,
                    comment: source.comment,
                    enabled: !source.enabled,
                    isAdult: source.isAdult
                )
            )
            await loadSources()
        } catch {
            report(error)
        }
    }

    func checkAllSources() async {
        isCheckingAll = true
        do {
            try await apiClient.checkAllSources()
            // Backend health checks are asynchronous, so wait briefly before reloading.
            //
            // 后端健康检查是异步执行的, 因此短暂等待后再刷新列表.
            try? await Task.sleep(for: .seconds(5))
            await loadSources()
        } catch {
            report(error)
        }
        isCheckingAll = false
    }

    // MARK: - Subscriptions

    func loadSubscriptions() async {
        do {
            subscriptions = try await apiClient.listSubscriptions().subscriptions
        } catch {
            report(error)
        }
    }

    /// Creates a subscription; returns whether it succeeded, with the failure in `createError`.
    ///
    /// 创建订阅; 返回是否成功, 失败原因保存在 `createError` 中.
    func createSubscription(url: String, interval: Int, autoUpdate: Bool) async -> Bool {
        createError = nil
        do {
            _ = try await apiClient.createSubscription(CreateSubscriptionRequest(url: url, autoUpdate: autoUpdate, interval: interval))
        } catch {
            createError = error.localizedDescription
            return false
        }
        await loadSubscriptions()
        return true
    }

    func syncSubscription(_ sub: Subscription) async {
        syncingSubId = sub.id
        do {
            try await apiClient.syncSubscription(id: sub.id)
            successMessage = String(localized: "Sync completed")
            await loadSubscriptions()
        } catch {
            report(error)
        }
        syncingSubId = nil
    }

    /// Deletes subscriptions, then reloads the list once.
    ///
    /// 删除若干订阅, 然后只重新加载一次列表.
    func deleteSubscriptions(_ subs: [Subscription]) async {
        do {
            for sub in subs { try await apiClient.deleteSubscription(id: sub.id) }
        } catch {
            report(error)
        }
        await loadSubscriptions()
    }

    // MARK: - Users

    func loadUsers() async {
        do {
            users = try await apiClient.listUsers().users
        } catch {
            report(error)
        }
    }

    /// Creates a user; returns whether it succeeded, with the failure in `createError`.
    ///
    /// 创建用户; 返回是否成功, 失败原因保存在 `createError` 中.
    func createUser(username: String, password: String, role: String, allowAdultContent: Bool) async -> Bool {
        createError = nil
        do {
            _ = try await apiClient.createUser(CreateUserRequest(
                username: username,
                password: password,
                role: role,
                allowAdultContent: allowAdultContent
            ))
        } catch {
            createError = error.localizedDescription
            return false
        }
        await loadUsers()
        return true
    }

    func deleteUser(_ user: User) async {
        await deleteUsers([user])
    }

    /// Deletes users, then reloads the list once. A batch that includes the signed-in admin is
    /// rejected as a whole.
    ///
    /// 删除若干用户, 然后只重新加载一次列表. 批次中包含当前登录的管理员时整体拒绝.
    func deleteUsers(_ users: [User]) async {
        guard !users.contains(where: { $0.id == currentUserId }) else {
            error = String(localized: "Cannot delete yourself")
            return
        }
        do {
            for user in users { try await apiClient.deleteUser(id: user.id) }
        } catch {
            report(error)
        }
        await loadUsers()
    }

    // MARK: - Settings

    func loadSettings() async {
        do {
            settings = try await apiClient.getSettings().settings
        } catch {
            report(error)
        }
    }

    /// The value of a setting, or its default while the server has none.
    ///
    /// 某项设置的值; 服务端没有值时返回默认值.
    func value(of key: SettingKey) -> String {
        let stored = settings[key.rawValue] ?? ""
        return stored.isEmpty ? key.defaultValue : stored
    }

    /// Saves a setting unless it already has that value.
    ///
    /// 保存某项设置; 值未变化时不发送请求.
    func setValue(_ value: String, for key: SettingKey) async {
        guard value != self.value(of: key) else { return }
        await updateSetting(key: key.rawValue, value: value)
    }

    func updateSetting(key: String, value: String) async {
        // Optimistically update local settings so the form reflects the user's choice immediately,
        // and restore the previous value when the server rejects it.
        //
        // 先乐观更新本地设置, 让表单立即反映用户选择; 服务端拒绝时恢复原值.
        let previous = settings[key]
        settings[key] = value
        do {
            try await apiClient.updateSettings([key: value])
        } catch {
            settings[key] = previous
            report(error)
        }
    }
}
