import Foundation
@testable import KMTV

/// Records the toasts a view model shows, in order, instead of drawing them.
///
/// 按顺序记录视图模型显示的提示, 而不绘制它们.
@MainActor
final class ToastRecorder: ToastPresenting {
    private(set) var shown: [(message: String, style: ToastStyle)] = []

    /// The messages shown so far, oldest first.
    ///
    /// 目前已显示的消息, 按时间从早到晚排列.
    var messages: [String] { shown.map(\.message) }

    func show(_ message: String, style: ToastStyle) {
        shown.append((message, style))
    }
}
