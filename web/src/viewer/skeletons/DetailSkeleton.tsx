/**
 * DetailSkeleton — Suspense fallback mirroring the DetailPage two-column layout.
 * DetailSkeleton — 镜像 DetailPage 双列布局的 Suspense 回退组件.
 *
 * Responsibilities / 职责:
 *   - Provide a layout-accurate placeholder while DetailPage's lazy chunk loads — 在 DetailPage 懒加载块期间提供布局精确的占位符
 *   - Prevent cumulative layout shift by reusing the real CSS class graph — 通过复用真实 CSS 类图防止累积布局偏移
 *   - Signal screen readers that content is loading via role="status" + aria-busy — 通过 role="status" + aria-busy 向屏幕阅读器告知内容正在加载
 *
 * Layout shadow / 布局镜像:
 *   Mirrors DetailPage's main grid: .detail-player-grid
 *     Left (.detail-main):  playback panel + state pills + description copy
 *     Right (.detail-sidebar): source picker list + episode grid
 *   镜像 DetailPage 主网格: .detail-player-grid
 *     左侧 (.detail-main): 播放面板 + 状态 pill + 描述文案
 *     右侧 (.detail-sidebar): source picker 列表 + 集数网格
 *
 * Callers / 调用方:
 *   app/AppRoutes.tsx (Suspense fallback for the /detail/:source/:id lazy route)
 *
 * Test exclusion / 测试排除:
 *   This file matches the vitest.config.ts coverage exclude pattern for skeletons directories.
 *   No tests are needed: this component has no conditional branches, no state, and no callbacks.
 *   All branching is structural CSS driven by the real DetailPage layout; visual correctness
 *   is validated by E2E Suspense observation.
 *   此文件匹配 vitest.config.ts 的 skeletons 目录覆盖率排除模式.
 *   无需测试: 该组件无条件分支、无状态、无回调.
 *   所有分支均由真实 DetailPage 布局驱动的结构 CSS; 视觉正确性由 E2E Suspense 观察验证.
 */

import { Skeleton } from "@/shared/ui/Skeleton";

/**
 * DetailSkeleton — pure presentational Suspense fallback for DetailPage.
 * DetailSkeleton — DetailPage 的纯展示型 Suspense 回退.
 *
 * Uses aria-hidden on decorative sub-sections so screen readers skip the
 * individual placeholder shapes and only announce the top-level role="status".
 * 对装饰性子区域使用 aria-hidden, 让屏幕阅读器跳过单个占位形状,
 * 只公告顶层 role="status".
 */
export function DetailSkeleton() {
  return (
    <section className="detail-skeleton detail-player-grid" role="status" aria-busy="true" aria-label="Loading">
      <div className="detail-main" aria-hidden="true">
        <div className="playback-panel">
          <Skeleton className="detail-skeleton-player" />
          <div className="player-state-pills">
            <Skeleton width="64px" height="22px" />
            <Skeleton width="92px" height="22px" />
            <Skeleton width="72px" height="22px" />
          </div>
        </div>
        <section className="detail-copy">
          <p className="muted">
            <Skeleton width="240px" height="0.95rem" />
          </p>
          <h1>
            <Skeleton width="62%" height="3.2rem" />
          </h1>
          <p>
            <Skeleton width="100%" height="1rem" />
            <Skeleton width="96%" height="1rem" />
            <Skeleton width="80%" height="1rem" />
          </p>
        </section>
      </div>
      <aside className="detail-sidebar" aria-hidden="true">
        <div className="source-picker">
          <Skeleton width="40%" height="1rem" />
          {Array.from({ length: 4 }).map((_, idx) => (
            <Skeleton key={idx} height="38px" />
          ))}
        </div>
        <div className="detail-skeleton-episode-section">
          <Skeleton width="36%" height="1rem" />
          <div className="episode-grid detail-skeleton-episodes">
            {Array.from({ length: 12 }).map((_, idx) => (
              <Skeleton key={idx} height="34px" />
            ))}
          </div>
        </div>
      </aside>
    </section>
  );
}
