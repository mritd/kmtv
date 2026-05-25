/**
 * SearchSkeleton — Suspense fallback mirroring the SearchPage result list layout.
 * SearchSkeleton — 镜像 SearchPage 结果列表布局的 Suspense 回退组件.
 *
 * Responsibilities / 职责:
 *   - Provide a layout-accurate placeholder during the "loading" SSE phase — 在 SSE "loading" 阶段提供布局精确的占位符
 *   - Prevent cumulative layout shift by reusing VideoResultCard's exact CSS class graph — 通过复用 VideoResultCard 的精确 CSS 类图防止累积布局偏移
 *   - Signal screen readers that content is loading via role="status" + aria-busy — 通过 role="status" + aria-busy 向屏幕阅读器告知内容正在加载
 *
 * Layout shadow / 布局镜像:
 *   Mirrors VideoResultCard's three-column grid:
 *     .video-result-card
 *       .poster-action     — poster image slot (left column)
 *       .video-result-copy — title + year/type + description + meta row (centre column)
 *       .video-result-actions — play + favorite buttons (right column)
 *   Real result cards land exactly where the placeholders sat — zero paint shift.
 *   镜像 VideoResultCard 的三列网格:
 *     .video-result-card
 *       .poster-action     — 海报图片槽 (左列)
 *       .video-result-copy — 标题 + 年份/类型 + 描述 + meta 行 (中列)
 *       .video-result-actions — 播放 + 收藏按钮 (右列)
 *   真实结果卡片精确落在占位符位置 — 零像素偏移.
 *
 * Usage context / 使用场景:
 *   Rendered by SearchPage while status="loading" (SSE stream in progress).
 *   Also reused by FavoritesSkeleton for its result-list placeholder cards.
 *   在 SearchPage 中 status="loading" 时渲染 (SSE 流进行中).
 *   也被 FavoritesSkeleton 复用作结果列表占位卡片.
 *
 * Callers / 调用方:
 *   viewer/search/SearchPage.tsx (rendered while status="loading")
 *   viewer/skeletons/FavoritesSkeleton.tsx (card shape reference)
 *
 * Test exclusion / 测试排除:
 *   This file matches the vitest.config.ts coverage exclude pattern for skeletons directories.
 *   No tests are needed: this component has no conditional branches, no state, and no callbacks.
 *   The `count` prop drives a static Array.from() — there is no branching logic.
 *   Visual correctness is validated by E2E Suspense observation and SearchPage.test.tsx integration.
 *   此文件匹配 vitest.config.ts 的 skeletons 目录覆盖率排除模式.
 *   无需测试: 该组件无条件分支、无状态、无回调.
 *   `count` prop 驱动静态 Array.from() — 无分支逻辑.
 *   视觉正确性由 E2E Suspense 观察和 SearchPage.test.tsx 集成测试验证.
 */

import { Skeleton } from "@/shared/ui/Skeleton";

/**
 * SearchSkeleton — pure presentational loading placeholder for the search result list.
 * SearchSkeleton — 搜索结果列表的纯展示型加载占位符.
 *
 * @param count — number of VideoResultCard placeholders to render (default 4) — 渲染的 VideoResultCard 占位数量 (默认 4)
 */
export function SearchSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="search-skeleton result-list" role="status" aria-busy="true" aria-label="Loading">
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
              <Skeleton width="94%" height="0.95rem" />
              <Skeleton width="74%" height="0.95rem" />
            </p>
            <div className="result-meta">
              <Skeleton width="92px" height="0.9rem" />
              <Skeleton width="120px" height="0.9rem" />
            </div>
          </div>
          <div className="video-result-actions">
            <Skeleton width="100%" height="42px" />
            <Skeleton width="100%" height="42px" />
          </div>
        </article>
      ))}
    </div>
  );
}
