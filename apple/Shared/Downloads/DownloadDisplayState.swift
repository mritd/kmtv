#if os(iOS)
import Foundation

/// Every observed input of `DownloadManager.displayState(of:)` besides the row itself, plus the
/// structural and progress counters; views that compute download state outside their body refresh
/// when it changes.
///
/// 除数据行本身外, `DownloadManager.displayState(of:)` 的全部被观察输入, 加上结构与进度计数; 在 body
/// 之外计算下载状态的视图会在它变化时刷新.
struct DownloadDisplayRevision: Equatable {
    var structure: Int
    var progress: Int
    var satisfied: Bool
    var expensive: Bool
    var constrained: Bool
    var allowsCellular: Bool
    var preparing: Set<String>
}

/// What a row shows for an episode.
///
/// 一集在列表行中展示的状态.
enum DownloadDisplayState: Equatable {
    case queued
    case preparing
    case downloading(Double)
    case waitingNetwork
    case waitingWiFi
    case paused(DownloadPauseReason)
    case completed
    case failed(DownloadFailure)
}

extension DownloadManager {
    /// Pure display-state rule: stored terminal and paused states win; otherwise an unusable path
    /// waits for the network, and an expensive path without the cellular setting (or Low Data
    /// Mode) waits for WiFi.
    ///
    /// 纯粹的展示状态规则: 持久化的终止与暂停状态优先; 否则网络不可用时等待网络, 网络昂贵且未允许
    /// 蜂窝数据 (或处于低数据模式) 时等待 WiFi.
    static func displayState(state: DownloadState, pauseReason: DownloadPauseReason?, failure: DownloadFailure?,
                             done: Int, total: Int, preparing: Bool, satisfied: Bool, expensive: Bool,
                             constrained: Bool, allowsCellular: Bool) -> DownloadDisplayState {
        switch state {
        case .completed: return .completed
        case .failed: return .failed(failure ?? .network)
        case .paused: return .paused(pauseReason ?? .user)
        case .queued, .downloading:
            if !satisfied { return .waitingNetwork }
            if constrained || (expensive && !allowsCellular) { return .waitingWiFi }
            if preparing { return .preparing }
            if state == .queued { return .queued }
            return .downloading(total > 0 ? Double(done) / Double(total) : 0)
        }
    }
}
#endif
