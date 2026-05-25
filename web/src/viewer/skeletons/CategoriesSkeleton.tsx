/**
 * CategoriesSkeleton — loading placeholder for the categories browse page.
 * CategoriesSkeleton — 分类浏览页的加载占位符.
 *
 * Responsibilities / 职责:
 *   - Mirror the CategoriesPage layout (header + filter rows + poster grid) to avoid layout shift
 *     — 镜像 CategoriesPage 布局 (头部 + 筛选行 + 海报网格) 以避免布局抖动
 *   - Provide a grid-only variant for the in-page "items loading" state (filters already rendered)
 *     — 提供仅网格变体, 用于页面内「条目加载中」状态 (筛选项已渲染)
 *   - Signal screen readers via role="status" + aria-busy — 通过 role="status" + aria-busy 告知屏幕阅读器
 *
 * Reuses the live .poster-tile / .poster-frame / .category-grid class graph so the skeleton and the
 * real grid share one CSS source of truth (zero drift risk).
 * 复用实时的 .poster-tile / .poster-frame / .category-grid 类图, 使骨架与真实网格共享同一 CSS 真相来源 (零漂移风险).
 *
 * Callers / 调用方:
 *   viewer/categories/CategoriesPage.tsx (full skeleton on metadata load; gridOnly on item refetch)
 *   app/AppRoutes.tsx (full skeleton as the Suspense fallback for the /categories lazy route)
 *
 * Test exclusion / 测试排除:
 *   Matches the vitest.config.ts skeletons coverage exclude; visual correctness is validated by E2E.
 *   匹配 vitest.config.ts 的 skeletons 覆盖率排除; 视觉正确性由 E2E 验证.
 */

import { Skeleton } from "@/shared/ui/Skeleton";

// CategoryGridSkeleton renders a wrap grid of placeholder poster tiles.
// CategoryGridSkeleton 渲染一组占位海报砖块的换行网格.
function CategoryGridSkeleton() {
  return (
    <div className="category-grid" aria-hidden="true">
      {Array.from({ length: 12 }).map((_, idx) => (
        <div className="poster-rail-item" key={idx}>
          <span className="poster-tile">
            <span className="poster-frame">
              <Skeleton className="poster-skeleton-frame" />
            </span>
            <span className="poster-title">
              <Skeleton width="88%" height="0.9rem" />
            </span>
            <span className="poster-meta">
              <Skeleton width="40%" height="0.8rem" />
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * CategoriesSkeleton — presentational loading fallback for CategoriesPage.
 * CategoriesSkeleton — CategoriesPage 的展示型加载回退.
 *
 * Pass `gridOnly` to render just the poster grid (used when the filters are already visible and
 * only the item list is refetching after a filter change). Otherwise renders the full page shell.
 * 传入 gridOnly 仅渲染海报网格 (用于筛选项已可见、仅条目列表在筛选变更后重新拉取时);
 * 否则渲染完整页面外壳.
 */
export function CategoriesSkeleton({ gridOnly = false }: { gridOnly?: boolean }) {
  if (gridOnly) {
    return (
      <div className="categories-skeleton" role="status" aria-busy="true" aria-label="Loading">
        <CategoryGridSkeleton />
      </div>
    );
  }

  return (
    <div className="categories-skeleton" role="status" aria-busy="true" aria-label="Loading">
      <header className="categories-header">
        <h1>
          <Skeleton width="120px" height="1.8rem" />
        </h1>
      </header>
      <div className="categories-filters" aria-hidden="true">
        <div className="category-tabs">
          {Array.from({ length: 4 }).map((_, idx) => (
            <Skeleton key={idx} width="64px" height="1.6rem" />
          ))}
        </div>
        <div className="category-chip-row">
          {Array.from({ length: 6 }).map((_, idx) => (
            <Skeleton key={idx} width="56px" height="28px" />
          ))}
        </div>
      </div>
      <CategoryGridSkeleton />
    </div>
  );
}
