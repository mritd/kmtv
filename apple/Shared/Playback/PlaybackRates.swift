import Foundation

/// The playback speeds the player offers, shared by the inline rate menu and the system fullscreen
/// controls.
///
/// 播放器提供的倍速, 由内嵌倍速菜单与系统全屏控件共用.
enum PlaybackRates {
    /// Every offered rate, slowest first.
    ///
    /// 所有可选倍速, 从慢到快.
    static let all: [Float] = [1.0, 1.5, 2.0]

    /// The rate as the UI shows it: "1x", "1.5x", "2x".
    ///
    /// UI 中显示的倍速文字: "1x", "1.5x", "2x".
    static func label(_ rate: Float) -> String {
        String(format: "%.2gx", rate)
    }
}
