/**
 * HomePage — the viewer home page showing the hero carousel and recommendation rails.
 * HomePage — 观看者首页, 展示英雄轮播和豆瓣推荐 rail.
 *
 * Responsibilities / 职责:
 *   - Fetch Douban home sections via useDoubanHomeQuery (react-query key ["douban-home"])
 *     — 通过 useDoubanHomeQuery 获取豆瓣首页分区 (react-query key ["douban-home"])
 *   - Show HomeSkeleton while loading, StatusState on error, EmptyState when sections are empty
 *     — 加载中展示 HomeSkeleton, 出错展示 StatusState, 分区为空展示 EmptyState
 *   - Derive hero candidates via selectHeroCandidates and pass to HomeHero
 *     — 通过 selectHeroCandidates 推导英雄候选项并传给 HomeHero
 *   - Render each section as a horizontal poster rail with staggered entrance animation
 *     — 将每个分区渲染为带 stagger 入场动画的水平海报 rail
 *   - Navigate to /search?q=<title> when a poster tile is clicked
 *     — 点击海报砖块时导航至 /search?q=<title>
 *   - Respect the user's prefers-reduced-motion preference by disabling stagger variants
 *     — 通过禁用 stagger variants 尊重用户的 prefers-reduced-motion 偏好
 *
 * Key exports / 主要导出:
 *   HomePage
 *
 * Callers / 调用方:
 *   app/AppRoutes.tsx (lazy-loaded as the / route)
 *
 * React Query key contract (TIER 4 LOCKED):
 *   ["douban-home"] — consumed by useDoubanHomeQuery; do not change.
 *   ["douban-home"] — 由 useDoubanHomeQuery 消费; 不得更改.
 *
 * STAGGER_CAP bounds the staggered list-entrance animation so arbitrarily long rails
 * do not produce proportionally long delays for items beyond the cap.
 * STAGGER_CAP 为列表入场动画设置上限, 使长列表中超出 cap 的条目不产生额外延迟.
 */

import { useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useDoubanHomeQuery } from "@/api/viewerHooks";
import { Button } from "@/shared/ui/Button";
import { EmptyState } from "@/shared/ui/EmptyState";
import { PosterImage } from "@/shared/ui/PosterImage";
import { StatusState } from "@/shared/ui/StatusState";
import { staggerChild, staggerParent } from "@/animation/motionPresets";

import { HomeSkeleton } from "@/viewer/skeletons/HomeSkeleton";

import { HomeHero } from "./HomeHero";
import { selectHeroCandidates } from "./heroCandidates";
import { translateRailName } from "./railLabel";

// STAGGER_CAP bounds list-entrance staggering so long rails do not produce arbitrarily long animations.
// STAGGER_CAP
// 为列表入场动画设上限, 避免长列表导致动画过长.
const STAGGER_CAP = 8;

/**
 * formatRailRating formats a raw Douban rate string for display on a poster tile badge.
 * formatRailRating
 * 将原始豆瓣 rate 字符串格式化以在海报砖块徽章上显示.
 *
 * Returns "N/A" when rate is missing, blank, or "0" so every poster always shows a rating badge.
 * 当 rate 缺失、为空或为 "0" 时返回 "N/A", 确保每张海报始终显示评分徽章.
 */
function formatRailRating(rate?: string) {
  const value = rate?.trim();
  return value && value !== "0" ? value : "N/A";
}

/**
 * HomePage is the root viewer route rendered at /.
 * HomePage
 * 是渲染在 / 路由下的观看者根组件.
 *
 * Data flow:
 *   useDoubanHomeQuery → sections → selectHeroCandidates → HomeHero
 *                                  → poster rails (staggered motion.div list)
 *
 * Loading state: renders aria-busy="true" main + HomeSkeleton (Suspense-compatible shape).
 * Error state: renders HomeHero (empty candidates) + StatusState in the content area.
 * Empty state: renders HomeHero (empty candidates) + EmptyState in the content area.
 * Success state: renders HomeHero with candidates + full poster rail grid.
 *
 * 数据流:
 *   useDoubanHomeQuery → sections → selectHeroCandidates → HomeHero
 *                                  → 海报 rail (stagger motion.div 列表)
 *
 * 加载状态: 渲染 aria-busy="true" main + HomeSkeleton.
 * 错误状态: 渲染空 candidates 的 HomeHero + 内容区 StatusState.
 * 空数据状态: 渲染空 candidates 的 HomeHero + 内容区 EmptyState.
 * 成功状态: 渲染带候选项的 HomeHero + 完整海报 rail 网格.
 */
export function HomePage() {
  const navigate = useNavigate();
  const { t } = useTranslation("viewer");
  const query = useDoubanHomeQuery();
  const sections = useMemo(() => query.data?.sections ?? [], [query.data?.sections]);
  const heroCandidates = useMemo(() => selectHeroCandidates(sections), [sections]);
  // When the user prefers reduced motion, stagger variants resolve to instant.
  // 用户偏好减少动画时, stagger 立即完成.
  const reduceMotion = useReducedMotion() ?? false;
  const parentVariants = reduceMotion ? undefined : staggerParent;
  const childVariants = reduceMotion ? undefined : staggerChild;

  /**
   * searchTitle navigates to the search page pre-filled with the given title.
   * searchTitle
   * 导航至预填标题的搜索页.
   *
   * The title is URI-encoded to handle special characters in movie names.
   * title 经 URI 编码处理, 以正确传递电影名中的特殊字符.
   */
  function searchTitle(title: string) {
    navigate(`/search?q=${encodeURIComponent(title)}`);
  }

  if (query.isLoading) {
    return (
      <main className="home-page" aria-busy="true" aria-label={t("home.loading")}>
        <HomeSkeleton />
      </main>
    );
  }

  return (
    <main className="home-page">
      <HomeHero candidates={heroCandidates} onSearchTitle={searchTitle} onFallbackSearch={() => navigate("/search")} />

      <div className="home-content">
        {query.isError ? (
          <StatusState
            title={t("home.errorTitle")}
            description={t("home.errorDescription")}
            tone="error"
            action={
              <Button type="button" variant="secondary" onClick={() => navigate("/search")}>
                {t("home.errorAction")}
              </Button>
            }
          />
        ) : null}
        {!query.isError && sections.length === 0 ? (
          <EmptyState
            title={t("home.emptyTitle")}
            description={t("home.emptyDescription")}
            action={
              <Button type="button" variant="primary" onClick={() => navigate("/search")}>
                {t("home.emptyAction")}
              </Button>
            }
          />
        ) : null}

        {sections.map((section) => {
          const localizedName = translateRailName(t, section.name);
          return (
          <section className="rail-section" key={section.name}>
            <div className="section-heading">
              <h2>{localizedName}</h2>
              <span>{t("home.sectionCount", { count: section.items.length })}</span>
            </div>
            <motion.div
              className="poster-rail"
              role="list"
              aria-label={localizedName}
              variants={parentVariants}
              initial="hidden"
              animate="visible"
            >
              {section.items.map((item, index) => (
                <motion.div
                  className="poster-rail-item"
                  key={`${section.name}-${item.id}`}
                  role="listitem"
                  // Only the first STAGGER_CAP items stagger to keep total animation time bounded on long rails.
                  // 只有前 STAGGER_CAP 项参与 stagger, 长列表的动画时长保持稳定.
                  variants={index < STAGGER_CAP ? childVariants : undefined}
                >
                  <button className="poster-tile" type="button" onClick={() => searchTitle(item.title)}>
                    <span className="poster-frame">
                      <PosterImage src={item.cover} title={item.title} />
                      <span className="poster-rating-badge">{formatRailRating(item.rate)}</span>
                    </span>
                    <span className="poster-title">{item.title}</span>
                    {item.year ? <span className="poster-meta">{item.year}</span> : null}
                  </button>
                </motion.div>
              ))}
            </motion.div>
          </section>
          );
        })}
      </div>
    </main>
  );
}
