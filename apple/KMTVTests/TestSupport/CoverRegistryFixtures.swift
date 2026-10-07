import Foundation
@testable import KMTV

/// A fresh cover registry over its own `UserDefaults` suite, so tests never reach the app's
/// registry in `UserDefaults.standard`. Call `clearCoverRegistrySuite(_:)` in tear-down.
///
/// 基于独立 `UserDefaults` suite 的新封面登记表, 测试因此不会触及 `UserDefaults.standard` 中 App 的
/// 登记表. 在 tear-down 中调用 `clearCoverRegistrySuite(_:)`.
@MainActor
func makeCoverRegistry(suite: String) throws -> CoverRegistry {
    clearCoverRegistrySuite(suite)
    guard let defaults = UserDefaults(suiteName: suite) else {
        throw CocoaError(.featureUnsupported)
    }
    return CoverRegistry(defaults: defaults)
}

/// Removes everything a test registry stored in `suite`.
///
/// 删除测试登记表在 `suite` 中保存的全部内容.
func clearCoverRegistrySuite(_ suite: String) {
    UserDefaults().removePersistentDomain(forName: suite)
}
