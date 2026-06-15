// CustomSlider — thin progress slider with small round thumb that grows on drag. Production uses
// PanResponder; tests drive the same callbacks through the _panForTest prop.
// CustomSlider — 细进度条 + 小圆头, 拖动时放大. 生产使用 PanResponder; 测试通过 _panForTest 触发同一回调.

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  PanResponder, StyleSheet, View, type LayoutChangeEvent, type GestureResponderEvent,
  type PanResponderGestureState,
} from "react-native";

const TRACK_HEIGHT = 3;
const THUMB_IDLE = 8;
const THUMB_ACTIVE = 14;
const SLIDER_HEIGHT = 32;

/**
 * Props for CustomSlider — value in [0, 1] plus optional drag callbacks.
 * CustomSlider 的 props — value 在 [0, 1] 之间, 配合可选的拖动回调.
 */
export interface CustomSliderProps {
  value: number;
  onDragStart?: () => void;
  onDragEnd?: (ratio: number) => void;
  testID?: string;
  /**
   * Test escape hatch — production code never sets this. Receives a function that fires the same
   * drag callbacks PanResponder would, so the component is testable under jest. Marked `@internal`
   * so tsc surfaces it but consumer-facing tooling (typedoc, IDE hints in app code) hides it.
   * 测试逃生口 — 生产代码不设置. 接受一个回调, 内部触发与 PanResponder 等价的拖动回调.
   * 标记 `@internal`, tsc 仍可见, 但文档与 IDE 提示对消费方隐藏.
   * @internal
   */
  _panForTest?: (pan: (ratio: number, phase: "start" | "end") => void) => void;
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function sliderRatioFromPageX(pageX: number, sliderLeft: number, width: number): number {
  if (width <= 0 || !Number.isFinite(pageX) || !Number.isFinite(sliderLeft)) return 0;
  return clamp01((pageX - sliderLeft) / width);
}

/**
 * Thin slider with growing thumb. Updates display position immediately during drag, but only
 * commits the seek when the gesture ends.
 * 拖动时立即更新视觉位置, 松手时才执行 seek 提交.
 */
export function CustomSlider({ value, onDragStart, onDragEnd, testID, _panForTest }: CustomSliderProps) {
  const [width, setWidth] = useState(0);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const widthRef = useRef(0);
  const rootRef = useRef<View | null>(null);
  const sliderLeftRef = useRef(0);
  const hasSliderLeftRef = useRef(false);

  const measureSlider = useCallback(() => {
    rootRef.current?.measureInWindow((x, _y, measuredWidth) => {
      sliderLeftRef.current = x;
      hasSliderLeftRef.current = true;
      if (measuredWidth > 0) {
        setWidth(measuredWidth);
        widthRef.current = measuredWidth;
      }
    });
  }, []);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setWidth(w);
    widthRef.current = w;
    measureSlider();
  }, [measureSlider]);

  const ratioFromResponder = useCallback((
    evt: GestureResponderEvent,
    gestureState?: PanResponderGestureState,
  ) => {
    const w = widthRef.current || 1;
    const absoluteX = gestureState?.moveX ?? evt.nativeEvent.pageX;
    if (hasSliderLeftRef.current && Number.isFinite(absoluteX)) {
      return sliderRatioFromPageX(absoluteX, sliderLeftRef.current, w);
    }
    return clamp01(evt.nativeEvent.locationX / w);
  }, []);

  const dispatchPan = useCallback((ratio: number, phase: "start" | "end") => {
    const clamped = clamp01(ratio);
    if (phase === "start") {
      setDragValue(clamped);
      onDragStart?.();
    } else {
      setDragValue(null);
      onDragEnd?.(clamped);
    }
  }, [onDragEnd, onDragStart]);

  // Keep a ref to the latest dispatchPan so the once-created PanResponder always sees the latest
  // onDragStart/onDragEnd. Without this the responder would capture only the first render's
  // callbacks and later rate / duration changes would be dropped.
  // 用 ref 持有最新 dispatchPan, 让仅创建一次的 PanResponder 始终命中最新的回调.
  // 否则 responder 会闭包首次渲染的回调, 后续 rate / duration 改变将丢失.
  const dispatchPanRef = useRef(dispatchPan);
  useEffect(() => { dispatchPanRef.current = dispatchPan; }, [dispatchPan]);

  useEffect(() => {
    _panForTest?.(dispatchPan);
  }, [_panForTest, dispatchPan]);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        measureSlider();
        dispatchPanRef.current(ratioFromResponder(evt), "start");
      },
      onPanResponderMove: (evt, gestureState) => {
        setDragValue(ratioFromResponder(evt, gestureState));
      },
      onPanResponderRelease: (evt, gestureState) => {
        dispatchPanRef.current(ratioFromResponder(evt, gestureState), "end");
      },
      onPanResponderTerminate: () => {
        setDragValue(null);
      },
    }),
  ).current;

  const display = dragValue ?? value;
  const isDragging = dragValue !== null;
  const thumbSize = isDragging ? THUMB_ACTIVE : THUMB_IDLE;
  const thumbX = Math.max(0, Math.min(Math.max(0, width - thumbSize), width * clamp01(display) - thumbSize / 2));
  const trackTop = (SLIDER_HEIGHT - TRACK_HEIGHT) / 2;
  const thumbTop = (SLIDER_HEIGHT - thumbSize) / 2;

  return (
    <View
      ref={rootRef}
      onLayout={onLayout}
      testID={testID}
      style={styles.root}
      accessibilityRole="adjustable"
      accessibilityValue={{ now: Math.round(display * 100), min: 0, max: 100 }}
      {...responder.panHandlers}
    >
      <View style={[styles.trackBg, { top: trackTop }]} />
      <View style={[styles.trackFill, { top: trackTop, width: Math.max(0, width * clamp01(display)) }]} />
      <View testID={testID ? `${testID}-thumb` : undefined} style={[styles.thumb, { width: thumbSize, height: thumbSize, left: thumbX, top: thumbTop }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { height: SLIDER_HEIGHT },
  trackBg: { position: "absolute", left: 0, right: 0, height: TRACK_HEIGHT, borderRadius: TRACK_HEIGHT / 2, backgroundColor: "rgba(255,255,255,0.3)" },
  trackFill: { position: "absolute", left: 0, height: TRACK_HEIGHT, borderRadius: TRACK_HEIGHT / 2, backgroundColor: "white" },
  thumb: { position: "absolute", borderRadius: 999, backgroundColor: "white" },
});
