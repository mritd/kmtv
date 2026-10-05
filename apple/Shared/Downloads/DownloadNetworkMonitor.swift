#if os(iOS)
import Foundation
import Network
import Observation

/// Current network path for download states: whether it is usable, expensive (cellular or a
/// personal hotspot), or constrained (Low Data Mode).
///
/// 下载状态所用的当前网络路径: 是否可用, 是否昂贵 (蜂窝网络或个人热点), 是否受限 (低数据模式).
@Observable
@MainActor
final class DownloadNetworkMonitor {
    private(set) var isSatisfied = true
    private(set) var isExpensive = false
    private(set) var isConstrained = false
    /// Called when the path becomes usable again.
    ///
    /// 网络路径重新可用时调用.
    @ObservationIgnored var onRestore: (@MainActor () -> Void)?
    @ObservationIgnored private let monitor = NWPathMonitor()

    init(start: Bool = true) {
        guard start else { return }
        monitor.pathUpdateHandler = { [weak self] path in
            let satisfied = path.status == .satisfied
            let expensive = path.isExpensive
            let constrained = path.isConstrained
            Task { @MainActor in self?.update(satisfied: satisfied, expensive: expensive, constrained: constrained) }
        }
        monitor.start(queue: DispatchQueue(label: "com.mritd.kmtv.network"))
    }

    /// Applies a path; `onRestore` runs when an unusable path becomes usable.
    ///
    /// 应用一个网络路径; 不可用的路径变为可用时运行 `onRestore`.
    func update(satisfied: Bool, expensive: Bool, constrained: Bool) {
        let restored = !isSatisfied && satisfied
        isSatisfied = satisfied
        isExpensive = expensive
        isConstrained = constrained
        if restored { onRestore?() }
    }
}
#endif
