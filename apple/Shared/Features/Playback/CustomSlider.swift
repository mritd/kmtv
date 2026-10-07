#if os(iOS)
import SwiftUI

/// A thin progress slider with small round thumb, matching typical video player style.
/// Drag updates the visual position immediately; actual seek happens on drag end. A drag that
/// never ends normally (the system cancels it, or the slider goes away) reports `onDragCancel`.
///
/// 带小圆形滑块的细进度条, 拖动时立即更新视觉位置, 松手后执行真实 seek.
/// 没有正常结束的拖动 (被系统取消, 或进度条消失) 会通过 `onDragCancel` 报告.
///
/// Internal rather than private so a test can render it: the buffered track is three
/// overlapping capsules, and layer order and width are only observable in pixels.
///
/// 使用 internal 而非 private 以便测试渲染它: 已缓冲轨道由三条重叠的胶囊构成,
/// 其层叠顺序与宽度只能在像素层面观察到.
struct CustomSlider: View {
    @Binding var value: Double // 0...1
    var buffered: Double = 0 // 0...1
    var onDragStart: () -> Void = {}
    var onDragEnd: (Double) -> Void = { _ in }
    var onDragCancel: () -> Void = {}

    @State private var isDragging = false
    @State private var dragValue: Double = 0
    // True while the gesture is active; SwiftUI resets it when the gesture ends or is cancelled,
    // and a cancel is the reset that arrives without `onEnded`.
    //
    // 手势进行中为 true; 手势结束或取消时 SwiftUI 会将其复位, 而取消就是没有 `onEnded` 的那次复位.
    @GestureState private var isGestureActive = false

    private var displayValue: Double {
        isDragging ? dragValue : value
    }

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let clamped = max(0, min(1, displayValue))
            let thumbX = width * CGFloat(clamped)

            ZStack(alignment: .leading) {
                // Track background.
                //
                // 轨道背景.
                Capsule()
                    .fill(Color.white.opacity(0.3))
                    .frame(height: 3)

                // Buffered track, between the background and the played fill so the played
                // portion still reads as the brightest thing on the bar.
                //
                // 已缓冲轨道, 位于背景与已播放填充之间,
                // 使已播放部分仍是进度条上最亮的一层.
                Capsule()
                    .fill(Color.white.opacity(0.5))
                    .frame(width: max(0, width * CGFloat(max(0, min(1, buffered)))), height: 3)

                // Track fill.
                //
                // 已播放进度.
                Capsule()
                    .fill(Color.white)
                    .frame(width: max(0, thumbX), height: 3)

                // Thumb.
                //
                // 拖动滑块.
                Circle()
                    .fill(Color.white)
                    .frame(width: isDragging ? 14 : 8, height: isDragging ? 14 : 8)
                    .offset(x: max(0, thumbX - (isDragging ? 7 : 4)))
            }
            .frame(height: geo.size.height)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .updating($isGestureActive) { _, active, _ in active = true }
                    .onChanged { drag in
                        if !isDragging {
                            isDragging = true
                            onDragStart()
                        }
                        let ratio = Double(drag.location.x / width)
                        dragValue = max(0, min(1, ratio))
                        // Update binding for live time display.
                        //
                        // 拖动时同步更新时间显示.
                        value = dragValue
                    }
                    .onEnded { _ in
                        isDragging = false
                        onDragEnd(dragValue)
                    }
            )
        }
        .onChange(of: isGestureActive) { _, active in
            // Checked a turn later, so a normal end has run `onEnded` first whatever order SwiftUI
            // delivers the reset in; only a cancelled drag is still marked as dragging then.
            //
            // 推迟一个轮次再检查, 无论 SwiftUI 以何种顺序投递复位, 正常结束时 `onEnded` 都已先执行;
            // 届时仍标记为拖动中的只有被取消的拖动.
            guard !active else { return }
            Task { @MainActor in cancelDrag() }
        }
        .onDisappear { cancelDrag() }
    }

    /// Ends a drag that did not finish through `onEnded`; does nothing after a normal end.
    ///
    /// 结束未经 `onEnded` 完成的拖动; 正常结束后调用不做任何事.
    private func cancelDrag() {
        guard isDragging else { return }
        isDragging = false
        onDragCancel()
    }
}
#endif
