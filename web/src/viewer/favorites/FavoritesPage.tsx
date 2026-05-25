/**
 * viewer/favorites/FavoritesPage.tsx — saved-favorites list page.
 * viewer/favorites/FavoritesPage.tsx — 已收藏列表页面.
 *
 * Responsibilities / 职责:
 *   - Read and render the user's favorited items from localStorage — 从 localStorage 读取并渲染用户收藏条目
 *   - Augment each item's rating from Douban home data when the item's stored rate is missing — 当条目缺少 rate 时从豆瓣主页数据补充评分
 *   - Allow the user to search by title (navigate to /search?q=…) — 允许用户按标题搜索 (跳转到 /search?q=…)
 *   - Allow the user to remove a favorite without leaving the page — 允许用户在不离开页面的情况下取消收藏
 *
 * Key exports / 主要导出:
 *   FavoritesPage
 *
 * Callers / 调用方:
 *   app/AppRoutes.tsx — mounted at /favorites via React Router
 *
 * localStorage key: delegated to storage/favorites.ts (favoritesKey = "kmtv.favorites")
 * Tier 4 locked — do NOT rename the key or change the FavoriteItem schema.
 * Tier 4 锁定 — 不得重命名 key 或修改 FavoriteItem schema.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { DoubanHomeSection } from "@/api/types";
import { useDoubanHomeQuery } from "@/api/viewerHooks";
import { listFavorites, toggleFavorite, type FavoriteItem } from "@/storage/favorites";
import { Button } from "@/shared/ui/Button";
import { EmptyState } from "@/shared/ui/EmptyState";
import { PosterImage } from "@/shared/ui/PosterImage";

// normalizedRating trims and rejects the sentinel "0" value that some sources emit when unrated.
// normalizedRating 修剪并拒绝部分来源在无评分时发出的哨兵值 "0".
function normalizedRating(rate?: string): string | undefined {
  const value = rate?.trim();
  return value && value !== "0" ? value : undefined;
}

// homeRatingsByTitle builds a lookup map from the Douban home sections for augmenting stored favorites
// that were saved before Douban rating data was available.
// homeRatingsByTitle 从豆瓣主页区块构建查找 map, 用于补充在豆瓣评分数据可用前保存的收藏.
function homeRatingsByTitle(sections: DoubanHomeSection[]): Map<string, string> {
  const ratings = new Map<string, string>();
  for (const section of sections) {
    for (const item of section.items) {
      const rating = normalizedRating(item.rate);
      // Only the first rating for a title is kept; later duplicates are ignored.
      // 每个标题只保留首个评分; 后续重复项被忽略.
      if (rating && !ratings.has(item.title)) {
        ratings.set(item.title, rating);
      }
    }
  }
  return ratings;
}

// favoriteRatingValue resolves the display rating for a favorite item.
// Priority: item's own stored rate → Douban home augmentation → undefined (renders as "N/A").
// favoriteRatingValue 解析收藏条目的展示评分.
// 优先级: 条目自身存储的 rate → 豆瓣主页补充 → undefined (渲染为 "N/A").
function favoriteRatingValue(item: FavoriteItem, homeRatings: Map<string, string>): string | undefined {
  return normalizedRating(item.rate) ?? homeRatings.get(item.title);
}

/**
 * FavoritesPage renders the user's saved-favorites list with rating badges and search/remove actions.
 * FavoritesPage 渲染用户的收藏列表, 包含评分徽标以及搜索/取消收藏操作.
 *
 * Favorites are read from localStorage on mount and kept in local state for instant removal without
 * a round-trip to the store.
 * 收藏在挂载时从 localStorage 读取并保存到本地状态, 以便即时删除而无需往返 store.
 */
export function FavoritesPage() {
  const { t } = useTranslation("viewer");
  const navigate = useNavigate();
  // Local copy of favorites so removal is instant without re-reading localStorage.
  // 本地收藏副本, 使取消收藏即时生效而无需重新读取 localStorage.
  const [items, setItems] = useState<FavoriteItem[]>(() => listFavorites());
  const homeQuery = useDoubanHomeQuery();
  const homeRatings = useMemo(() => homeRatingsByTitle(homeQuery.data?.sections ?? []), [homeQuery.data?.sections]);

  function searchFavorite(item: FavoriteItem) {
    const params = new URLSearchParams({ q: item.title });
    navigate(`/search?${params.toString()}`);
  }

  function removeFavorite(item: FavoriteItem) {
    // toggleFavorite mutates localStorage and returns the updated list.
    // toggleFavorite 修改 localStorage 并返回更新后的列表.
    setItems(toggleFavorite(item));
  }

  return (
    <main className="page favorites-page">
      <section className="page-header">
        <div>
          <p className="eyebrow">{t("favorites.eyebrow")}</p>
          <h1>{t("favorites.title")}</h1>
          <p className="page-header-summary">{t("favorites.summary", { count: items.length })}</p>
        </div>
      </section>

      {items.length === 0 ? (
        <EmptyState
          title={t("favorites.emptyTitle")}
          description={t("favorites.emptyDescription")}
          action={
            <Button type="button" variant="primary" onClick={() => navigate("/search")}>
              {t("favorites.emptyAction")}
            </Button>
          }
        />
      ) : null}
      <div className="result-list">
        {items.map((item) => (
          <FavoriteResultCard
            // key uses source_key + video_id for stability; title alone is not unique across sources.
            // key 使用 source_key + video_id 保持稳定; 仅靠标题在多来源间不唯一.
            key={`${item.source.source_key}-${item.source.video_id}`}
            item={item}
            ratingValue={favoriteRatingValue(item, homeRatings)}
            onSearch={searchFavorite}
            onRemove={removeFavorite}
          />
        ))}
      </div>
    </main>
  );
}

/**
 * FavoriteResultCard renders a single favorite item as an article card.
 * FavoriteResultCard 将单个收藏条目渲染为 article 卡片.
 *
 * This component is file-private; only FavoritesPage should render it.
 * 此组件为文件私有; 只有 FavoritesPage 应渲染它.
 *
 * @param item - The favorite item to display — 要显示的收藏条目
 * @param ratingValue - Pre-resolved rating string (undefined → shows "N/A" via i18n) — 预解析的评分字符串 (undefined → 通过 i18n 显示 "N/A")
 * @param onSearch - Navigate to search by title — 按标题导航到搜索页
 * @param onRemove - Toggle-remove the item from favorites — 从收藏中切换删除条目
 */
function FavoriteResultCard({
  item,
  ratingValue,
  onSearch,
  onRemove,
}: {
  item: FavoriteItem;
  ratingValue?: string;
  onSearch(item: FavoriteItem): void;
  onRemove(item: FavoriteItem): void;
}) {
  const { t } = useTranslation("viewer");
  const subtitle = [item.type, item.year].filter(Boolean).join(" | ");
  // Fall back to i18n "N/A" label when ratingValue is absent.
  // 当 ratingValue 缺失时回退到 i18n "N/A" 标签.
  const ratingLabel = ratingValue ?? t("favorites.cardRatingMissing");

  return (
    <article className="video-result-card" aria-label={item.title}>
      <div className="poster-action">
        <span className="poster-frame">
          <PosterImage src={item.cover} title={item.title} />
          <span className="poster-rating-badge" aria-label={t("favorites.cardRatingAria", { rating: ratingLabel })}>
            {ratingLabel}
          </span>
        </span>
      </div>
      <div className="video-result-copy">
        <h3>{item.title}</h3>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
        {item.desc ? <p className="clamp">{item.desc}</p> : null}
      </div>
      <div className="video-result-actions">
        <Button type="button" variant="primary" onClick={() => onSearch(item)}>
          {t("favorites.cardSearchAction")}
        </Button>
        <Button type="button" variant="danger" onClick={() => onRemove(item)}>
          {t("favorites.cardRemoveAction")}
        </Button>
      </div>
    </article>
  );
}
