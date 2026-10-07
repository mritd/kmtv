import AVFoundation
import Foundation

/// The reports one player item makes while it plays. Each closure is registered for one item and
/// captures whatever identity its owner needs, so a report queued by a replaced item can be told
/// apart from the live one.
///
/// 一个播放 item 在播放期间发出的上报. 每个闭包只为一个 item 注册, 并捕获其所有者需要的标识,
/// 因此已被替换的 item 排队的上报可以与当前 item 区分开.
struct PlaybackCallbacks {
    /// Periodic playhead report: the current position and the item's duration, both finite.
    ///
    /// 周期性的播放头上报: 当前位置与 item 时长, 两者均为有限值.
    var onTime: @MainActor @Sendable (TimeInterval, TimeInterval) -> Void
    /// Wall-clock forward-buffer sample.
    ///
    /// 按墙钟采样的前向缓冲读数.
    var onBuffer: @MainActor @Sendable (BufferSample) -> Void
    /// The item played to its end.
    ///
    /// item 已播放到结尾.
    var onEnd: @MainActor @Sendable () -> Void
    /// The item failed, or did not become ready within the load timeout (nil message). At most once
    /// per item.
    ///
    /// item 播放失败, 或未在加载超时内就绪 (消息为 nil). 每个 item 至多一次.
    var onError: @MainActor @Sendable (String?) -> Void
}

/// The only API the player view models use to drive playback. `PlaybackCoordinator` is the
/// conformer that touches `AVPlayer`; tests substitute a fake to reach the transport paths.
///
/// 播放器视图模型驱动播放时使用的唯一 API. `PlaybackCoordinator` 是接触 `AVPlayer` 的实现;
/// 测试用替身替换它, 以覆盖播放传输相关的路径.
@MainActor
protocol PlaybackEngine: AnyObject, Sendable {
    /// The player to mount in a video view; nil before the first start and after `cleanup()`. Not
    /// for driving playback.
    ///
    /// 挂载到视频视图上的播放器; 首次开始之前与 `cleanup()` 之后为 nil. 不用于驱动播放.
    var player: AVPlayer? { get }

    /// Starts or replaces playback with a resolved URL. Local items pass `allowsExternalPlayback`
    /// false; with `loadTimeout`, an item that is not ready by then reports `onError(nil)`.
    ///
    /// 使用已解析的 URL 开始播放或替换当前播放项. 本地内容传入 `allowsExternalPlayback` 为 false;
    /// 传入 `loadTimeout` 时, 届时仍未就绪的 item 会以 `onError(nil)` 上报.
    func start(url: URL, startTime: TimeInterval, rate: Float, allowsExternalPlayback: Bool,
               loadTimeout: Duration?, callbacks: PlaybackCallbacks)

    /// Pauses playback.
    ///
    /// 暂停播放.
    func pause()

    /// Plays at `rate`.
    ///
    /// 以 `rate` 倍速播放.
    func resume(rate: Float)

    /// Sets the rate for the next play, and the current rate when already playing.
    ///
    /// 设置下一次播放的倍速; 正在播放时同时修改当前倍速.
    func setRate(_ rate: Float)

    /// The rate the user last chose, including one picked in the system fullscreen controls; nil
    /// without a player.
    ///
    /// 用户最近选择的倍速, 包括在系统全屏控件中选择的; 没有播放器时为 nil.
    var chosenRate: Float? { get }

    /// Seeks to `time`. The completion runs on the main actor one turn after the player finished,
    /// with false when a newer seek superseded this one. Without a player nothing happens and the
    /// completion never runs, so callers check `player` first.
    ///
    /// seek 到 `time`. 播放器完成后在主 actor 的下一轮次调用 completion; 被更新的 seek 顶替时传入
    /// false. 没有播放器时什么也不做且永远不调用 completion, 因此调用方需先检查 `player`.
    func seek(to time: TimeInterval, completion: @escaping @MainActor @Sendable (Bool) -> Void)

    /// The playhead in seconds; nil without a player. May be non-finite while nothing is loaded.
    ///
    /// 播放头位置, 单位秒; 没有播放器时为 nil. 尚未加载内容时可能不是有限值.
    var currentTime: TimeInterval? { get }

    /// The current item's duration in seconds; nil without a current item. May be non-finite until
    /// the item knows it.
    ///
    /// 当前 item 的时长, 单位秒; 没有当前 item 时为 nil. item 得知时长之前可能不是有限值.
    var itemDuration: TimeInterval? { get }

    /// The player's transport state; nil without a player.
    ///
    /// 播放器的播放传输状态; 没有播放器时为 nil.
    var timeControlStatus: AVPlayer.TimeControlStatus? { get }

    /// Stops the load watchdog while the app is in the background.
    ///
    /// App 在后台时停止加载看门狗.
    func suspendLoadWatchdog()

    /// Re-arms the load watchdog when the current item is still loading.
    ///
    /// 当前 item 仍在加载时重新启用加载看门狗.
    func resumeLoadWatchdog()

    /// Gives the current item the title and subtitle the system player shows.
    ///
    /// 为当前 item 设置系统播放器显示的标题与副标题.
    func setTitleMetadata(title: String, subtitle: String)

    /// Reports whether the player is paused, once right away and then on every transport change,
    /// on the main actor; nil stops reporting. `cleanup()` stops it too.
    ///
    /// 在主 actor 上报告播放器是否暂停: 先立即报告一次, 之后每次播放传输状态变化时报告; 传入 nil
    /// 停止报告. `cleanup()` 同样会停止.
    func observePause(_ handler: (@MainActor @Sendable (Bool) -> Void)?)

    /// Pauses, removes every observer, and releases the player.
    ///
    /// 暂停, 移除所有观察者并释放播放器.
    func cleanup()
}
