import Foundation

extension Collection {
    /// Returns nil instead of trapping when the index is outside bounds.
    ///
    /// 当索引越界时返回 nil, 避免触发运行时崩溃.
    subscript(safe index: Index) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
