// Skeleton and SkeletonGroup — shimmer placeholder blocks for loading states.
// Skeleton 和 SkeletonGroup — 加载状态的闪烁占位块组件.
//
// Exports: Skeleton, SkeletonGroup.
// Callers: page-level skeletons under src/*/skeletons/, any component that needs an inline loading placeholder.
// 调用者: src/*/skeletons/ 下的页面级骨架屏, 以及需要内联加载占位的组件.
//
// ARIA strategy: SkeletonGroup is the single aria-busy live region; individual Skeleton children are
// decorative (aria-hidden) unless used standalone. Using multiple status regions causes screen readers
// to announce every shimmer independently — avoid that by always preferring SkeletonGroup.
// ARIA 策略: SkeletonGroup 是唯一的 aria-busy 实时区域; 子 Skeleton 默认装饰性 (aria-hidden),
// 除非设置 standalone=true. 多个 status 区域会让屏幕阅读器独立播报每个闪烁块, 应优先使用 SkeletonGroup.

import type { CSSProperties, ReactNode } from "react";

// Skeleton renders a single shimmering placeholder block.
// Skeleton 渲染单个闪烁占位块.
//
// When used inside a SkeletonGroup, leave standalone=false (default) so only the group
// is announced by screen readers. Set standalone=true only when the skeleton appears
// in isolation without a wrapping SkeletonGroup.
// 在 SkeletonGroup 内使用时保持 standalone=false (默认值), 只让 group 被屏幕阅读器播报.
// 仅在没有 SkeletonGroup 包裹的独立使用场景下才设置 standalone=true.
export function Skeleton({
  className = "",
  width,
  height,
  ariaLabel,
  // standalone=true exposes the skeleton as its own status region (use when not inside a SkeletonGroup).
  // standalone=true
  // 让 skeleton 作为独立 status 区域 (不在 SkeletonGroup 内时使用).
  standalone = false,
}: {
  className?: string;
  width?: string | number;
  height?: string | number;
  ariaLabel?: string;
  standalone?: boolean;
}) {
  const style: CSSProperties = {};
  if (width !== undefined) style.width = typeof width === "number" ? `${width}px` : width;
  if (height !== undefined) style.height = typeof height === "number" ? `${height}px` : height;
  // Nested status regions cause screen readers to announce repeatedly. SkeletonGroup is the canonical live region;
  // children are decorative unless explicitly standalone.
  // 嵌套的 status 区域会让屏幕阅读器重复播报, SkeletonGroup 是规范的 live region, 内部 skeleton 默认装饰性.
  const role = standalone ? "status" : undefined;
  const ariaProps = standalone
    ? { "aria-busy": true as const, "aria-label": ariaLabel ?? "Loading" }
    : { "aria-hidden": true as const };
  return (
    <span
      className={`skeleton ${className}`.trim()}
      role={role}
      {...ariaProps}
      style={style}
    />
  );
}

// SkeletonGroup wraps multiple Skeleton children and exposes a single aria-busy live region.
// SkeletonGroup 包裹多个 Skeleton 子节点并暴露统一的 aria-busy 实时区域.
//
// Prefer this over multiple standalone Skeletons to avoid redundant screen-reader announcements.
// 优先使用此组件而非多个独立 Skeleton, 以避免屏幕阅读器重复播报.
export function SkeletonGroup({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`skeleton-group ${className}`.trim()} role="status" aria-busy="true" aria-label="Loading">
      {children}
    </div>
  );
}
