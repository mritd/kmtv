/**
 * viewer/components/VideoResultCard.tsx — search result card for a single aggregated title.
 * viewer/components/VideoResultCard.tsx — 单个聚合标题的搜索结果卡片.
 *
 * Responsibilities / 职责:
 *   - Render title, poster, subtitle, description, source count, and fastest-source latency badge
 *     — 渲染标题、海报、副标题、简介、来源数量以及最快来源的延迟标签
 *   - Trigger detail-page navigation via the onOpen callback — 通过 onOpen 回调触发详情页导航
 *   - Optionally show an add/remove favorite button via onFavorite — 可选通过 onFavorite 显示收藏/取消按钮
 *   - Apply a view-transition-name on the poster image so the browser can animate it if the
 *     destination page registers a matching name — 为海报图写入 view-transition-name, 使浏览器在目标页注册相同名称时可平滑动画
 *
 * Key exports / 主要导出:
 *   VideoResultCard
 *
 * Callers / 调用方:
 *   viewer/search/SearchPage.tsx (search results list)
 *   viewer/favorites/FavoritesPage.tsx — NOT a caller; FavoritesPage uses its own FavoriteResultCard
 */
import { useTranslation } from "react-i18next";

import type { SearchResult } from "@/api/types";
import { posterTransitionName } from "@/animation/viewTransitions";
import { formatDuration } from "@/shared/format";
import { Button } from "@/shared/ui/Button";
import { PosterImage } from "@/shared/ui/PosterImage";

/**
 * VideoResultCard renders a single search result as a card with poster, metadata, and actions.
 * VideoResultCard 将单个搜索结果渲染为含海报、元数据和操作的卡片.
 *
 * @param item - The search result to display — 要显示的搜索结果
 * @param onOpen - Called when the user clicks play; receives the full result — 用户点击播放时调用, 接收完整结果
 * @param onFavorite - Optional; when provided shows a favorite/unfavorite button — 可选; 提供时显示收藏/取消按钮
 * @param isFavorited - Controls whether the favorite button shows "remove" style — 控制收藏按钮是否显示"取消"样式
 */
export function VideoResultCard({
  item,
  onOpen,
  onFavorite,
  isFavorited = false,
}: {
  item: SearchResult;
  onOpen(result: SearchResult, sourceIndex?: number): void;
  onFavorite?(result: SearchResult): void;
  isFavorited?: boolean;
}) {
  const { t } = useTranslation("viewer");
  const sources = safeSourceResults(item);
  const sourceCount = sources.length;
  // First source pairs with the detail page poster via a shared view-transition-name.
  // 首个 source 通过共享的 view-transition-name 与详情页海报配对.
  const firstSource = sources[0];
  const transitionName = firstSource ? posterTransitionName(firstSource.source_key, firstSource.video_id) : undefined;
  const fastest = sources
    .map((source) => source.duration_ms)
    .filter((duration): duration is number => typeof duration === "number" && duration > 0)
    .sort((a, b) => a - b)[0];
  const subtitle = [item.type, item.year].filter(Boolean).join(" | ");

  return (
    <article className="video-result-card">
      <button
        className="poster-action"
        type="button"
        onClick={() => onOpen(item)}
        disabled={sourceCount === 0}
        aria-label={sourceCount > 0 ? t("card.playAria", { title: item.title }) : t("card.posterDisabledAria")}
      >
        <PosterImage src={item.cover} title={item.title} transitionName={transitionName} />
      </button>
      <div className="video-result-copy">
        <h3>{item.title}</h3>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
        {item.desc ? <p className="clamp">{item.desc}</p> : null}
        <div className="result-meta">
          <span>{sourceCount > 0 ? t("card.sourcesCount", { count: sourceCount }) : t("card.noSources")}</span>
          {fastest ? <span>{t("card.fastest", { value: formatDuration(fastest) })}</span> : null}
        </div>
      </div>
      <div className="video-result-actions">
        <Button type="button" variant="primary" onClick={() => onOpen(item)} disabled={sourceCount === 0}>
          {sourceCount > 0 ? t("card.play") : t("card.noSources")}
        </Button>
        {onFavorite ? (
          <Button type="button" variant={isFavorited ? "danger" : "ghost"} onClick={() => onFavorite(item)} disabled={sourceCount === 0}>
            {isFavorited ? t("card.unfavorite") : t("card.favorite")}
          </Button>
        ) : null}
      </div>
    </article>
  );
}

// safeSourceResults guards against third-party APIs that return null instead of an empty array.
// safeSourceResults 防止第三方 API 返回 null 而非空数组.
function safeSourceResults(item: SearchResult) {
  // Search sources come from third-party-compatible APIs, so runtime null must render as no source.
  // 搜索来源来自第三方兼容 API, 运行时 null 必须按无来源渲染.
  return Array.isArray(item.sources) ? item.sources : [];
}
