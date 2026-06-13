// Tablet width breakpoints mirror design spec section 4 (Phone vs tablet).
// 平板宽度断点与设计 spec 第 4 节 (手机 vs 平板) 保持一致.

import { useWindowDimensions } from "react-native";

export const PHONE_MAX_DP = 599;
export const TABLET_MIN_DP = 600;
export const LARGE_TABLET_MIN_DP = 840;

export type LayoutWidth = "phone" | "tablet" | "largeTablet";

/**
 * Classify a width in density-independent pixels into phone / tablet / largeTablet.
 * 将 dp 宽度归类为 phone / tablet / largeTablet.
 */
export function pickLayoutWidth(width: number): LayoutWidth {
  if (width >= LARGE_TABLET_MIN_DP) return "largeTablet";
  if (width >= TABLET_MIN_DP) return "tablet";
  return "phone";
}

/**
 * Hook returning the current LayoutWidth, reactive to dimension changes.
 * 返回当前 LayoutWidth 的 hook, 跟随尺寸变化更新.
 */
export function useLayoutWidth(): LayoutWidth {
  const { width } = useWindowDimensions();
  return pickLayoutWidth(width);
}

/**
 * Poster grid column count per spec section 4 thresholds.
 * 按 spec 第 4 节阈值计算海报网格列数.
 */
export function pickNumColumns(width: number): number {
  if (width >= LARGE_TABLET_MIN_DP) return 5;
  if (width >= TABLET_MIN_DP) return 4;
  return 3;
}
