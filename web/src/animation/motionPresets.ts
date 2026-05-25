/**
 * animation/motionPresets — canonical Motion/React animation presets for KMTV.
 * animation/motionPresets — KMTV 全局 Motion/React 动画预设.
 *
 * Responsibility / 职责:
 *   Defines shared timing constants, easing curves, reduced-motion fallback, and
 *   stagger variant pairs that components import directly.  All values are `as const`
 *   so callers receive literal types and cannot accidentally mutate them.
 *   定义共用时长常量、缓动曲线、减少动画回退值及列表交错变体, 供组件直接引用.
 *   所有值使用 `as const` 保证调用方得到字面量类型且不能意外修改.
 *
 * Exports / 导出:
 *   - transitions         — timing + easing presets (fastFade / pageSlide / modalPop)
 *   - reducedMotionTransition — zero-duration override for prefers-reduced-motion
 *   - staggerParent       — Motion variant for a list container (triggers staggering)
 *   - staggerChild        — Motion variant for each list item (fade + slide up)
 *
 * Callers / 调用方:
 *   app/AppRoutes.tsx (transitions.pageSlide), shared/ui/Modal.tsx (transitions.modalPop,
 *   reducedMotionTransition), viewer/home/HomePage.tsx and viewer/search/SearchPage.tsx
 *   (staggerParent, staggerChild).  Each caller is responsible for gating motion by
 *   checking window.matchMedia("(prefers-reduced-motion: reduce)") and substituting
 *   reducedMotionTransition before passing a transition prop.
 *   调用方各自负责检测 prefers-reduced-motion 媒体查询并在传递 transition prop 前替换为
 *   reducedMotionTransition; 本模块不持有任何媒体查询逻辑.
 *
 * Vitest coverage exclude rationale / 排除原因:
 *   vitest.config.ts excludes `src/animation/**` from *coverage* (not from test discovery).
 *   This module exports only static configuration objects with no branching logic; a
 *   sibling test file exists in __tests__/motionPresets.test.ts for import-level smoke
 *   checks, but it does not contribute meaningful coverage numbers.
 *   vitest.config.ts 将 `src/animation/**` 排除于覆盖率统计 (而非测试发现). 本模块仅导出无分支
 *   的静态配置对象; __tests__/motionPresets.test.ts 提供导入级别的冒烟测试, 但不贡献有意义的覆盖率数字.
 */

import type { Transition } from "motion/react";

// transitions — canonical timing presets for the three motion scenarios in KMTV.
// transitions — KMTV 三种动画场景的标准时长预设.
//
// Easing arrays are cubic-bezier control points [x1, y1, x2, y2] (CSS easing spec).
// 缓动数组为三次贝塞尔控制点 [x1, y1, x2, y2] (CSS 缓动规范).
//   [0.4, 0, 0.2, 1]  — Material-style standard easing: fast start, gentle end.
//                        Material 标准缓动: 快速启动, 柔和结束. 适合元素淡入淡出.
//   [0.22, 1, 0.36, 1] — Expo-out-ish spring feel: used for full-page slide where
//                         perceived responsiveness matters more than symmetry.
//                         类指数衰减弹性: 用于全页滑动, 优先感知响应速度.
export const transitions = {
  fastFade: { type: "tween", duration: 0.18, ease: [0.4, 0, 0.2, 1] } satisfies Transition,
  pageSlide: { type: "tween", duration: 0.42, ease: [0.22, 1, 0.36, 1] } satisfies Transition,
  modalPop: { type: "tween", duration: 0.22, ease: [0.4, 0, 0.2, 1] } satisfies Transition,
} as const;

// reducedMotionTransition — zero-duration fallback for the prefers-reduced-motion media query.
// reducedMotionTransition — 响应 prefers-reduced-motion 媒体查询时的零时长回退值.
//
// WHY: WCAG 2.1 SC 2.3.3 requires that motion-triggered content can be disabled.
// Callers detect the media query themselves and swap out the transition prop; this
// constant provides a single canonical "instant" preset to avoid duplicate magic numbers.
// 原因: WCAG 2.1 SC 2.3.3 要求动画内容可被禁用. 调用方自行检测媒体查询后替换过渡配置,
// 此常量提供唯一的"零时长"预设, 避免在各组件中散布重复的魔法数字.
export const reducedMotionTransition: Transition = { duration: 0 };

// staggerParent — Motion variant for a list container that fans out child animations.
// staggerParent — 列表容器的 Motion 变体, 用于控制子项入场动画的延迟扩散.
//
// staggerChildren: 0.04 — 40 ms between each child start.  Faster values feel choppy;
// slower values (> 80 ms) feel laggy for lists of 5+ items.
// staggerChildren: 0.04 — 每个子项延迟 40 ms 开始. 更快会显得生硬, 超过 80 ms 在5项以上列表中会感觉迟缓.
export const staggerParent = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04 } },
} as const;

// staggerChild — Motion variant for each item inside a staggerParent container.
// staggerChild — staggerParent 容器内每个子项的 Motion 变体.
//
// y: 8 — small upward slide (8 px) avoids the heavy "flying in from below" effect while
// still providing spatial context that the item is entering from below the fold.
// y: 8 — 轻微上移 8 px, 避免"从下方飞入"的笨重感, 同时保留元素从下方进入的空间感.
export const staggerChild = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
} as const;
