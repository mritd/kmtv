/**
 * FavoritesSkeleton — Suspense fallback mirroring the FavoritesPage layout.
 * FavoritesSkeleton — 镜像 FavoritesPage 布局的 Suspense 回退组件.
 *
 * Responsibilities / 职责:
 *   - Provide a layout-accurate placeholder while FavoritesPage's lazy chunk loads — 在 FavoritesPage 懒加载块期间提供布局精确的占位符
 *   - Prevent cumulative layout shift by reusing the real CSS class graph — 通过复用真实 CSS 类图防止累积布局偏移
 *   - Signal screen readers that content is loading via role="status" + aria-busy — 通过 role="status" + aria-busy 向屏幕阅读器告知内容正在加载
 *
 * Layout shadow / 布局镜像:
 *   Mirrors FavoritesPage:
 *     .favorites-skeleton
 *       .page-header — eyebrow + h1 + summary line
 *       .result-list  — VideoResultCard placeholders (poster + copy + actions)
 *   Card shape is identical to SearchSkeleton's .video-result-card placeholders.
 *   镜像 FavoritesPage:
 *     .favorites-skeleton
 *       .page-header — eyebrow + h1 + 摘要行
 *       .result-list  — VideoResultCard 占位 (海报 + 文案 + 操作)
 *   卡片形状与 SearchSkeleton 的 .video-result-card 占位相同.
 *
 * Callers / 调用方:
 *   app/AppRoutes.tsx (Suspense fallback for the /favorites lazy route)
 *
 * Test exclusion / 测试排除:
 *   This file matches the vitest.config.ts coverage exclude pattern for skeletons directories.
 *   No tests are needed: this component has no conditional branches, no state, and no callbacks.
 *   The `count` prop drives a static Array.from() — there is no branching logic.
 *   Visual correctness is validated by E2E Suspense observation.
 *   此文件匹配 vitest.config.ts 的 skeletons 目录覆盖率排除模式.
 *   无需测试: 该组件无条件分支、无状态、无回调.
 *   `count` prop 驱动静态 Array.from() — 无分支逻辑.
 *   视觉正确性由 E2E Suspense 观察验证.
 */

import { Skeleton } from "@/shared/ui/Skeleton";

/**
 * FavoritesSkeleton — pure presentational Suspense fallback for FavoritesPage.
 * FavoritesSkeleton — FavoritesPage 的纯展示型 Suspense 回退.
 *
 * @param count — number of VideoResultCard placeholders to render (default 4) — 渲染的 VideoResultCard 占位数量 (默认 4)
 */
export function FavoritesSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="favorites-skeleton" role="status" aria-busy="true" aria-label="Loading">
      <section className="page-header" aria-hidden="true">
        <div>
          <p className="eyebrow">
            <Skeleton width="120px" height="0.9rem" />
          </p>
          <h1>
            <Skeleton width="260px" height="2.6rem" />
          </h1>
          <p className="page-header-summary">
            <Skeleton width="180px" height="1rem" />
          </p>
        </div>
      </section>
      <div className="result-list">
        {Array.from({ length: count }).map((_, idx) => (
          <article className="video-result-card" key={idx} aria-hidden="true">
            <span className="poster-action">
              <Skeleton className="search-skeleton-poster" />
            </span>
            <div className="video-result-copy">
              <h3>
                <Skeleton width="62%" height="1.35rem" />
              </h3>
              <p className="muted">
                <Skeleton width="40%" height="0.95rem" />
              </p>
              <p className="clamp">
                <Skeleton width="100%" height="0.95rem" />
                <Skeleton width="92%" height="0.95rem" />
                <Skeleton width="72%" height="0.95rem" />
              </p>
            </div>
            <div className="video-result-actions">
              <Skeleton width="100%" height="42px" />
              <Skeleton width="100%" height="42px" />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
