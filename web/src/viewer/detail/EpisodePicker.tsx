/**
 * viewer/detail/EpisodePicker.tsx — episode selection control for the detail page sidebar.
 * viewer/detail/EpisodePicker.tsx — 详情页侧边栏的集数选择控件.
 *
 * Responsibilities / 职责:
 *   - Render a grid of episode buttons, one per episode in the current group — 渲染当前集数组的按钮网格
 *   - Highlight the currently selected episode — 高亮当前所选集数
 *   - Call onSelect with the chosen episode index and Episode object — 以所选索引和 Episode 对象调用 onSelect
 *   - Render nothing meaningful when the episodes array is empty (empty grid) — 集数为空时渲染空网格
 *
 * Key exports / 主要导出:
 *   EpisodePicker
 *
 * Callers / 调用方:
 *   viewer/detail/DetailPage.tsx — provides the episodes array from the current source detail
 *   viewer/playback/PlaybackPanel.tsx (fe-7 scope) — reads shared Episode type but does NOT call EpisodePicker
 *
 */
import { useTranslation } from "react-i18next";

import type { Episode } from "@/api/types";

/**
 * EpisodePicker renders the episode list for the currently active source group.
 * EpisodePicker 渲染当前活动来源组的集数列表.
 *
 * When episodes is empty the section renders with an empty grid; no special empty-state
 * is shown because the parent DetailPage controls visibility based on available data.
 * episodes 为空时渲染空网格; 父级 DetailPage 根据数据可用性控制可见性, 此处不做特殊空态处理.
 *
 * @param episodes - The flat list of episodes for the current group — 当前组的集数平铺列表
 * @param selectedIndex - Zero-based index of the currently playing episode — 当前播放集数的从零起始索引
 * @param onSelect - Called with (index, episode) when the user clicks an episode button — 用户点击集数按钮时以 (索引, 集数) 调用
 */
export function EpisodePicker({
  episodes,
  selectedIndex,
  onSelect,
}: {
  episodes: Episode[];
  selectedIndex: number;
  onSelect(index: number, episode: Episode): void;
}) {
  const { t } = useTranslation("viewer");
  return (
    <section className="detail-control-panel">
      <h2>{t("detail.episodePickerHeading")}</h2>
      <div className="episode-grid">
        {episodes.map((episode, index) => (
          <button
            // key uses name + index to remain stable within a group while tolerating duplicate names across sources.
            // key 使用 name + index, 在允许跨来源存在重名集数的同时保持组内稳定.
            className={index === selectedIndex ? "episode-button active" : "episode-button"}
            key={`${episode.name}-${index}`}
            type="button"
            onClick={() => onSelect(index, episode)}
            aria-label={t("detail.episodePlayAria", { name: episode.name })}
          >
            {episode.name}
          </button>
        ))}
      </div>
    </section>
  );
}
