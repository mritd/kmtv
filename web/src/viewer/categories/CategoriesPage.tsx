/**
 * CategoriesPage — the viewer browse page: category tabs + sub/region filter chips + a poster grid.
 * CategoriesPage — 观看者浏览页: 分类 tab + 子分类/地区筛选胶囊 + 海报网格.
 *
 * Responsibilities / 职责:
 *   - Fetch category metadata via useCategoriesQuery and the filtered item list via
 *     useDoubanRecommendInfiniteQuery — 通过 useCategoriesQuery 获取分类元数据, 通过 useDoubanRecommendInfiniteQuery 获取筛选后的条目列表
 *   - Read/write the persisted filter selection through categoriesStore — 通过 categoriesStore 读写持久化的筛选选择
 *   - Resolve selection → concrete group/sub/region and → recommend filter via categoryFilter
 *     — 通过 categoryFilter 将选择解析为具体 group/sub/region 及推荐筛选参数
 *   - Auto-load the next page via an IntersectionObserver sentinel at the grid bottom
 *     — 通过网格底部的 IntersectionObserver 哨兵自动加载下一页
 *   - Navigate to /search?q=<title> when a poster is clicked (Douban items are not directly
 *     playable — they map to an aggregated search, matching the home page and iOS client)
 *     — 点击海报时导航至 /search?q=<title> (豆瓣条目不可直接播放, 映射到聚合搜索, 与首页及 iOS 客户端一致)
 *
 * Key exports / 主要导出:
 *   CategoriesPage
 *
 * Callers / 调用方:
 *   app/AppRoutes.tsx (lazy-loaded as the /categories route)
 *
 * React Query key contract (TIER 4 LOCKED): ["douban-categories"], ["douban-recommend", ...].
 * Tier 4 锁定: ["douban-categories"], ["douban-recommend", ...].
 */

import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useStore } from "zustand";

import { useCategoriesQuery, useDoubanRecommendInfiniteQuery } from "@/api/viewerHooks";
import { Button } from "@/shared/ui/Button";
import { EmptyState } from "@/shared/ui/EmptyState";
import { PosterImage } from "@/shared/ui/PosterImage";
import { Skeleton } from "@/shared/ui/Skeleton";
import { StatusState } from "@/shared/ui/StatusState";
import { categoriesStore } from "@/store/categoriesStore";

import { CategoriesSkeleton } from "@/viewer/skeletons/CategoriesSkeleton";

import { resolveRecommendFilter, resolveSelection } from "./categoryFilter";
import { flattenCategoryPages } from "./categoryItems";

/**
 * formatGridRating formats a raw Douban rate string for a poster badge, mirroring the home rail.
 * formatGridRating
 * 将原始豆瓣 rate 字符串格式化为海报徽章, 与首页 rail 一致.
 *
 * Returns "N/A" when rate is missing, blank, or "0" so every poster shows a rating badge.
 * 当 rate 缺失、为空或为 "0" 时返回 "N/A", 确保每张海报都显示评分徽章.
 */
function formatGridRating(rate?: string): string {
  const value = rate?.trim();
  return value && value !== "0" ? value : "N/A";
}

/**
 * CategoriesPage is the viewer browse route rendered at /categories.
 * CategoriesPage
 * 是渲染在 /categories 路由下的观看者浏览页.
 *
 * Data flow:
 *   useCategoriesQuery → groups ─┐
 *   categoriesStore (selection) ─┴→ resolveSelection → resolveRecommendFilter
 *                                        → useDoubanRecommendInfiniteQuery → flattenCategoryPages → grid
 *
 * 数据流:
 *   useCategoriesQuery → groups ─┐
 *   categoriesStore (选择)      ─┴→ resolveSelection → resolveRecommendFilter
 *                                        → useDoubanRecommendInfiniteQuery → flattenCategoryPages → 网格
 */
export function CategoriesPage() {
  const { t } = useTranslation("viewer");
  const navigate = useNavigate();

  const categoriesQuery = useCategoriesQuery();
  const groups = useMemo(() => categoriesQuery.data?.categories ?? [], [categoriesQuery.data?.categories]);

  const groupKey = useStore(categoriesStore, (s) => s.groupKey);
  const subName = useStore(categoriesStore, (s) => s.subName);
  const regionName = useStore(categoriesStore, (s) => s.regionName);
  const selectGroup = useStore(categoriesStore, (s) => s.selectGroup);
  const selectSub = useStore(categoriesStore, (s) => s.selectSub);
  const selectRegion = useStore(categoriesStore, (s) => s.selectRegion);

  // Resolve the stored selection (names) against the loaded groups into concrete objects, then
  // derive the recommend filter. Both are memoised on their exact inputs.
  // 将存储的选择 (名称) 对照已加载分组解析为具体对象, 再推导推荐筛选参数; 二者按精确输入做 memo.
  const resolved = useMemo(
    () => resolveSelection(groups, { groupKey, subName, regionName }),
    [groups, groupKey, subName, regionName],
  );
  const filter = useMemo(() => resolveRecommendFilter(resolved), [resolved]);

  const recommendQuery = useDoubanRecommendInfiniteQuery(filter);
  const items = useMemo(
    () => flattenCategoryPages(recommendQuery.data?.pages),
    [recommendQuery.data?.pages],
  );

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = recommendQuery;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // loadingMoreRef is a synchronous single-flight latch. The isFetchingNextPage state guard alone can
  // miss a second observer callback that fires in the same tick before React commits the fetching
  // state; the ref closes that window so a fast-scroll prefetch issues exactly one request.
  // loadingMoreRef 是同步的单飞闸. 仅靠 isFetchingNextPage 状态判断无法拦截在 React 提交 fetching 状态前、
  // 同一时序内触发的第二次观察回调; ref 关上这个缝隙, 使快速滚动的预取只发出一次请求.
  const loadingMoreRef = useRef(false);

  // Auto-load the next page when the sentinel nears the viewport. The rootMargin makes the observer
  // fire ~800px BEFORE the sentinel is actually visible, so the next page is prefetched while the
  // user is still scrolling through the current rows — the last row rarely sits idle and incomplete.
  // Guarded for environments without IntersectionObserver; the dependency on hasNextPage/
  // isFetchingNextPage rebinds the observer so it stops firing once the list is exhausted or while a
  // page is already in flight.
  // 当哨兵接近视口时自动加载下一页. rootMargin 让观察器在哨兵真正可见前约 800px 就触发,
  // 因此用户还在浏览当前行时下一页已被预取 —— 最后一行很少静止地以残缺状态停留.
  // 对没有 IntersectionObserver 的环境做了防护; 依赖 hasNextPage/isFetchingNextPage 会重建观察器,
  // 使列表耗尽或某页加载中时停止触发.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined" || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && hasNextPage && !isFetchingNextPage && !loadingMoreRef.current) {
          loadingMoreRef.current = true;
          // .finally clears the latch on success, error, or cancellation so prefetch can resume.
          // .finally 在成功、出错或取消时清除闸, 使预取可以恢复.
          void fetchNextPage().finally(() => {
            loadingMoreRef.current = false;
          });
        }
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  /**
   * searchTitle navigates to the search page pre-filled with the given title.
   * searchTitle
   * 导航至预填标题的搜索页.
   */
  function searchTitle(title: string) {
    navigate(`/search?q=${encodeURIComponent(title)}`);
  }

  // While the category metadata loads, show the full-page skeleton.
  // 分类元数据加载期间展示整页骨架.
  if (categoriesQuery.isLoading) {
    return (
      <main className="categories-page" aria-busy="true" aria-label={t("categories.loading")}>
        <CategoriesSkeleton />
      </main>
    );
  }

  // Category metadata failed: the whole page cannot render filters, so show a page-level retry.
  // 分类元数据加载失败: 整页无法渲染筛选项, 展示页面级重试.
  if (categoriesQuery.isError) {
    return (
      <main className="categories-page">
        <header className="categories-header">
          <h1>{t("categories.title")}</h1>
        </header>
        <StatusState
          title={t("categories.errorTitle")}
          description={t("categories.errorDescription")}
          tone="error"
          action={
            <Button type="button" variant="secondary" onClick={() => void categoriesQuery.refetch()}>
              {t("categories.retry")}
            </Button>
          }
        />
      </main>
    );
  }

  const activeGroup = resolved.group;
  // Empty-name options are spacers in the upstream metadata; never render them as chips.
  // 空名称选项在上游元数据中是占位; 不渲染为胶囊.
  const subcategories = activeGroup?.subcategories.filter((sub) => sub.name.length > 0) ?? [];
  const regions = activeGroup?.regions.filter((region) => region.name.length > 0) ?? [];

  return (
    <main className="categories-page">
      <header className="categories-header">
        <h1>{t("categories.title")}</h1>
      </header>

      <div className="categories-filters">
        <nav className="category-tabs" aria-label={t("categories.tabsLabel")}>
          {groups.map((group) => {
            const isActive = group.key === activeGroup?.key;
            return (
              <button
                key={group.key}
                type="button"
                className={`category-tab${isActive ? " is-active" : ""}`}
                aria-pressed={isActive}
                onClick={() => selectGroup(group.key)}
              >
                {group.name}
              </button>
            );
          })}
        </nav>

        {subcategories.length > 0 ? (
          <div className="category-chip-row" role="group" aria-label={t("categories.subLabel")}>
            {subcategories.map((sub) => {
              const isActive = sub.name === resolved.sub?.name;
              return (
                <button
                  key={sub.name}
                  type="button"
                  className={`category-chip${isActive ? " is-active" : ""}`}
                  aria-pressed={isActive}
                  onClick={() => selectSub(sub.name)}
                >
                  {sub.name}
                </button>
              );
            })}
          </div>
        ) : null}

        {regions.length > 0 ? (
          <div className="category-chip-row category-chip-row-region" role="group" aria-label={t("categories.regionLabel")}>
            {regions.map((region) => {
              const isActive = region.name === resolved.region?.name;
              return (
                <button
                  key={region.name}
                  type="button"
                  className={`category-chip${isActive ? " is-active" : ""}`}
                  aria-pressed={isActive}
                  onClick={() => selectRegion(region.name)}
                >
                  {region.name}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="categories-content">
        {recommendQuery.isError ? (
          <StatusState
            title={t("categories.errorTitle")}
            description={t("categories.errorDescription")}
            tone="error"
            action={
              <Button type="button" variant="secondary" onClick={() => void recommendQuery.refetch()}>
                {t("categories.retry")}
              </Button>
            }
          />
        ) : recommendQuery.isLoading ? (
          <CategoriesSkeleton gridOnly />
        ) : items.length === 0 ? (
          <EmptyState title={t("categories.emptyTitle")} description={t("categories.emptyDescription")} />
        ) : (
          <>
            <div className="category-grid" role="list" aria-label={t("categories.title")}>
              {items.map((item) => (
                <div className="poster-rail-item" role="listitem" key={item.id}>
                  <button className="poster-tile" type="button" onClick={() => searchTitle(item.title)}>
                    <span className="poster-frame">
                      <PosterImage src={item.cover} title={item.title} />
                      <span className="poster-rating-badge">{formatGridRating(item.rate)}</span>
                    </span>
                    <span className="poster-title">{item.title}</span>
                    {item.year ? <span className="poster-meta">{item.year}</span> : null}
                  </button>
                </div>
              ))}
            </div>
            {hasNextPage ? (
              // Persistent bottom loading indicator: shown whenever more pages exist (not only while
              // actively fetching), so a partial last row never reads as "all loaded". It doubles as
              // the IntersectionObserver sentinel that triggers the prefetch.
              // 底部常驻加载指示: 只要还有更多页就显示 (不仅在主动拉取时), 使残缺的最后一行不会被误读为
              // 「已全部加载」. 它同时充当触发预取的 IntersectionObserver 哨兵.
              <div
                ref={sentinelRef}
                className="category-grid-more"
                role="status"
                aria-live="polite"
                aria-label={t("categories.loadingMore")}
              >
                <Skeleton className="category-grid-more-bar" />
              </div>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
