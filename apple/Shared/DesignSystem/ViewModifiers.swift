import SwiftUI

extension View {
    /// Applies a transform only when the condition is true while preserving view builder type inference.
    /// 仅在条件为 true 时应用转换, 同时保持 ViewBuilder 类型推断稳定.
    @ViewBuilder
    func applyIf<Content: View>(_ condition: Bool, transform: (Self) -> Content) -> some View {
        if condition {
            transform(self)
        } else {
            self
        }
    }
}
