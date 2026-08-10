/**
 * ContinueWatchingRail — presentational home rail for server-synced incomplete watch history.
 * ContinueWatchingRail — 首页继续观看展示 rail, 用于服务端同步的未完成观看记录.
 *
 * Responsibilities / 职责:
 *   - Render up to ten WatchHistoryItem entries as a semantic horizontal poster rail
 *     — 将最多十条 WatchHistoryItem 渲染为语义化横向海报 rail
 *   - Clamp derived progress into the accessible 0-100 range
 *     — 将派生进度限制在辅助技术可读的 0-100 范围内
 *   - Delegate selection and guarded clearing to parent callbacks without owning data fetching
 *     — 通过父级回调处理选择和受保护清空, 不拥有数据获取逻辑
 *
 * Key exports / 主要导出:
 *   ContinueWatchingRail, ContinueWatchingRailProps
 *
 * Callers / 调用方:
 *   viewer/home/HomePage.tsx (Task 3 integration)
 *
 * ADR locks / ADR 约束:
 *   ADR-014 requires bilingual module headers and JSDoc for exported symbols.
 *   ADR-014 要求双语模块头和导出符号 JSDoc.
 */

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";

import type { WatchHistoryItem } from "@/api/types";
import { staggerChild, staggerParent } from "@/animation/motionPresets";
import { Button } from "@/shared/ui/Button";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { PosterImage } from "@/shared/ui/PosterImage";

const maxRailItems = 10;

/**
 * ContinueWatchingRailProps are the pure presentation inputs for ContinueWatchingRail.
 * ContinueWatchingRailProps
 * 是 ContinueWatchingRail 的纯展示输入.
 *
 * `items` are already scoped and filtered by the parent data boundary. This component does not
 * fetch, mutate, or inspect authentication state.
 * items 已由父级数据边界完成作用域隔离和筛选. 此组件不获取数据, 不执行 mutation, 也不检查认证状态.
 */
export interface ContinueWatchingRailProps {
  items: WatchHistoryItem[];
  onSelect(item: WatchHistoryItem): void;
  onClear(): void;
  isClearing: boolean;
}

function clampProgressPercent(item: WatchHistoryItem): number {
  if (!Number.isFinite(item.progress_sec) || !Number.isFinite(item.duration_sec) || item.duration_sec <= 0) {
    return 0;
  }

  const rawPercent = Math.round((item.progress_sec / item.duration_sec) * 100);
  return Math.min(100, Math.max(0, rawPercent));
}

function episodeLabel(item: WatchHistoryItem): string | undefined {
  return item.episode.trim() || undefined;
}

/**
 * ContinueWatchingRail renders a horizontal continue-watching rail and a guarded clear action.
 * ContinueWatchingRail
 * 渲染横向继续观看 rail 和受保护的清空操作.
 *
 * The component is intentionally presentational: parent code supplies the already-loaded items,
 * selection callback, clear callback, and pending state. Empty inputs render nothing so HomePage
 * can fail quietly when history is unavailable.
 * 此组件有意保持纯展示: 父级传入已加载条目, 选择回调, 清空回调和 pending 状态.
 * 空输入不渲染内容, 让 HomePage 在观看记录不可用时保持静默降级.
 */
export function ContinueWatchingRail({
  items,
  onSelect,
  onClear,
  isClearing,
}: ContinueWatchingRailProps): React.JSX.Element | null {
  const { t } = useTranslation("viewer");
  const [isConfirmOpen, setConfirmOpen] = useState(false);
  const visibleItems = items.slice(0, maxRailItems);
  const reduceMotion = useReducedMotion() ?? false;
  const parentVariants = reduceMotion ? undefined : staggerParent;
  const childVariants = reduceMotion ? undefined : staggerChild;

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <section className="rail-section continue-section" aria-labelledby="continue-watching-heading">
      <div className="section-heading continue-heading">
        <div>
          <p className="eyebrow">{t("home.continueWatching.eyebrow")}</p>
          <h2 id="continue-watching-heading">{t("home.continueWatching.title")}</h2>
        </div>
        <div className="continue-actions">
          <span>{t("home.continueWatching.count", { count: visibleItems.length })}</span>
          <Button type="button" variant="ghost" onClick={() => setConfirmOpen(true)} disabled={isClearing}>
            {t("home.continueWatching.clearAction")}
          </Button>
        </div>
      </div>

      <motion.div
        className="poster-rail continue-rail"
        role="list"
        aria-label={t("home.continueWatching.title")}
        variants={parentVariants}
        initial="hidden"
        animate="visible"
      >
        {visibleItems.map((item, index) => {
          const progress = clampProgressPercent(item);
          const episode = episodeLabel(item);
          const progressText = t("home.continueWatching.progressSummary", { percent: progress });
          const progressLabel = episode
            ? t("home.continueWatching.progressAriaWithEpisode", { title: item.title, episode, percent: progressText })
            : t("home.continueWatching.progressAria", { title: item.title, percent: progressText });
          const cardLabel = episode
            ? t("home.continueWatching.cardAriaWithEpisode", { title: item.title, episode })
            : t("home.continueWatching.cardAria", { title: item.title });

          return (
            <motion.div
              className="poster-rail-item continue-rail-item"
              key={item.id}
              role="listitem"
              variants={index < maxRailItems ? childVariants : undefined}
            >
              <button className="poster-tile continue-card" type="button" onClick={() => onSelect(item)} aria-label={cardLabel}>
                <span className="poster-frame continue-frame">
                  <PosterImage src={item.cover} title={item.title} />
                  <span
                    className="continue-progress"
                    role="progressbar"
                    aria-label={progressLabel}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                  >
                    <span className="continue-progress-fill" style={{ transform: `scaleX(${progress / 100})` }} />
                  </span>
                </span>
                <span className="poster-title">{item.title}</span>
                {episode ? <span className="continue-meta-episode">{episode}</span> : null}
              </button>
            </motion.div>
          );
        })}
      </motion.div>

      {isConfirmOpen ? (
        <ConfirmDialog
          title={t("home.continueWatching.clearTitle")}
          description={t("home.continueWatching.clearDescription")}
          confirmLabel={isClearing ? t("home.continueWatching.clearPending") : t("home.continueWatching.clearConfirm")}
          cancelLabel={t("home.continueWatching.clearCancel")}
          confirmDisabled={isClearing}
          cancelDisabled={isClearing}
          onConfirm={onClear}
          onCancel={() => setConfirmOpen(false)}
        />
      ) : null}
    </section>
  );
}
