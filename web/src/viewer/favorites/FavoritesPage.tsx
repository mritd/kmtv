/**
 * viewer/favorites/FavoritesPage.tsx — saved-favorites list page.
 *
 * viewer/favorites/FavoritesPage.tsx — 已收藏列表页面.
 *
 * Responsibilities / 职责:
 *   - Read and render the user's favorited items from the sync store — 从同步存储读取并渲染用户收藏条目
 *   - Augment each item's rating from Douban home data when the item's stored rate is missing — 当条目缺少 rate 时从豆瓣主页数据补充评分
 *   - Allow the user to search by title (navigate to /search?q=…) — 允许用户按标题搜索 (跳转到 /search?q=…)
 *   - Allow the user to remove a favorite without leaving the page — 允许用户在不离开页面的情况下取消收藏
 *
 * Key exports / 主要导出:
 *   FavoritesPage
 *
 * Callers / 调用方:
 *   app/AppRoutes.tsx — mounted at /favorites via React Router
 */
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { DoubanHomeSection } from "@/api/types";
import { useDoubanHomeQuery } from "@/api/viewerHooks";
import { useSync, useSyncList } from "@/sync/SyncContext";
import type { LocalRecord } from "@/sync/types";
import { Button } from "@/shared/ui/Button";
import { EmptyState } from "@/shared/ui/EmptyState";
import { PosterImage } from "@/shared/ui/PosterImage";

type FavoriteItem = LocalRecord<"favorite">;

// normalizedRating trims and rejects the sentinel "0" value that some sources emit when unrated.
//
// normalizedRating 修剪并拒绝部分来源在无评分时发出的哨兵值 "0".
function normalizedRating(rate?: string): string | undefined {
  const value = rate?.trim();
  return value && value !== "0" ? value : undefined;
}

// homeRatingsByTitle builds a lookup map from the Douban home sections for augmenting stored favorites
// that were saved before Douban rating data was available.
//
// homeRatingsByTitle 从豆瓣主页区块构建查找 map, 用于补充在豆瓣评分数据可用前保存的收藏.
function homeRatingsByTitle(sections: DoubanHomeSection[]): Map<string, string> {
  const ratings = new Map<string, string>();
  for (const section of sections) {
    for (const item of section.items) {
      const rating = normalizedRating(item.rate);
      // Only the first rating for a title is kept; later duplicates are ignored.
      //
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
//
// favoriteRatingValue 解析收藏条目的展示评分.
// 优先级: 条目自身存储的 rate → 豆瓣主页补充 → undefined (渲染为 "N/A").
function favoriteRatingValue(item: FavoriteItem, homeRatings: Map<string, string>): string | undefined {
  return normalizedRating(item.payload.rate) ?? homeRatings.get(item.payload.title);
}

/**
 * FavoritesPage renders the user's saved-favorites list with rating badges and search/remove actions.
 *
 * FavoritesPage 渲染用户的收藏列表, 包含评分徽标以及搜索/取消收藏操作.
 *
 * Favorites come from the sync store, so removal is instant and synced in the background.
 *
 * 收藏来自同步存储, 因此删除即时生效并在后台同步.
 */
export function FavoritesPage() {
  const { t } = useTranslation("viewer");
  const navigate = useNavigate();
  const sync = useSync();
  const items = useSyncList("favorite");
  const engine = sync.status === "ready" ? sync.engine : null;
  useEffect(() => {
    void engine?.requestSync("page");
  }, [engine]);
  const homeQuery = useDoubanHomeQuery();
  const homeRatings = useMemo(() => homeRatingsByTitle(homeQuery.data?.sections ?? []), [homeQuery.data?.sections]);

  function searchFavorite(item: FavoriteItem) {
    const params = new URLSearchParams({ q: item.payload.title });
    navigate(`/search?${params.toString()}`);
  }

  function removeFavorite(item: FavoriteItem) {
    if (sync.status === "ready") sync.store.remove("favorite", item.key);
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
            key={item.key}
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
 *
 * FavoriteResultCard 将单个收藏条目渲染为 article 卡片.
 *
 * This component is file-private; only FavoritesPage should render it.
 *
 * 此组件为文件私有; 只有 FavoritesPage 应渲染它.
 *
 * @param item - The favorite item to display — 要显示的收藏条目
 * @param ratingValue - Pre-resolved rating string (undefined → shows "N/A" via i18n) — 预解析的评分字符串 (undefined → 通过 i18n 显示 "N/A")
 * @param onSearch - Navigate to search by title — 按标题导航到搜索页
 * @param onRemove - Remove the item from favorites — 从收藏中删除条目
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
  const subtitle = [item.payload.type, item.payload.year].filter(Boolean).join(" | ");
  // Fall back to i18n "N/A" label when ratingValue is absent.
  //
  // 当 ratingValue 缺失时回退到 i18n "N/A" 标签.
  const ratingLabel = ratingValue ?? t("favorites.cardRatingMissing");

  return (
    <article className="video-result-card" aria-label={item.payload.title}>
      <div className="poster-action">
        <span className="poster-frame">
          <PosterImage src={item.payload.cover} title={item.payload.title} />
          <span className="poster-rating-badge" aria-label={t("favorites.cardRatingAria", { rating: ratingLabel })}>
            {ratingLabel}
          </span>
        </span>
      </div>
      <div className="video-result-copy">
        <h3>{item.payload.title}</h3>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
        {item.payload.desc ? <p className="clamp">{item.payload.desc}</p> : null}
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
