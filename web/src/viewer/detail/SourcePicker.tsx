/**
 * viewer/detail/SourcePicker.tsx — video-source selection control for the detail page sidebar.
 * viewer/detail/SourcePicker.tsx — 详情页侧边栏的视频源选择控件.
 *
 * Responsibilities / 职责:
 *   - Render a list of source buttons sorted by probe latency (fastest first) — 渲染按探测延迟排序 (最快优先) 的来源按钮列表
 *   - Highlight the selected source with aria-pressed — 通过 aria-pressed 高亮所选来源
 *   - Show a latency badge with colour-coded tier (good/warn/bad/unknown) — 显示分级色彩 (好/中/差/未知) 的延迟徽标
 *   - Collapse sources beyond the first 8 behind a "show more" toggle — 超过 8 个来源时折叠并显示"显示更多"切换
 *   - Call onSelect with the source key when the user clicks a source — 用户点击来源时以来源 key 调用 onSelect
 *
 * Key exports / 主要导出:
 *   SourcePickerStatus, SourcePickerItem, SourcePicker
 *
 * Callers / 调用方:
 *   viewer/detail/DetailPage.tsx — provides the sources array and selectedKey
 *
 * SHARED TYPE NOTE: SourcePickerItem is imported by DetailPage (fe-5 scope) and may be imported by
 * viewer/playback/PlaybackPanel.tsx (fe-7 scope) in the future. Any field additions/removals are
 * Tier 3 — log in the contract before changing.
 * 共享类型说明: SourcePickerItem 由 DetailPage (fe-5 范围) 导入, 未来可能由 PlaybackPanel (fe-7) 导入.
 * 任何字段增删属 Tier 3 — 变更前在合约日志中登记.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

// visibleSourceLimit caps the number of source buttons shown before the "show more" toggle appears.
// visibleSourceLimit 限制"显示更多"切换出现前显示的来源按钮数量.
const visibleSourceLimit = 8;

/**
 * SourcePickerStatus represents the loading/fetch state of a single source's detail.
 * SourcePickerStatus 表示单个来源 detail 的加载/获取状态.
 *
 * "idle"    — detail not yet fetched — detail 尚未获取
 * "loading" — detail fetch in progress — detail 获取中
 * "ready"   — detail fetch succeeded — detail 获取成功
 * "failed"  — detail fetch failed — detail 获取失败
 */
export type SourcePickerStatus = "idle" | "loading" | "ready" | "failed";

/**
 * SourcePickerItem describes one entry in the source selection list.
 * SourcePickerItem 描述来源选择列表中的一条记录.
 *
 * SHARED TYPE — consumed by DetailPage; may be imported by PlaybackPanel (fe-7) in future.
 * Coordinate via contract log before changing any field.
 * 共享类型 — 被 DetailPage 使用; 未来可能被 PlaybackPanel (fe-7) 导入.
 * 变更任意字段前在合约日志中协调.
 *
 * `key` - Stable identifier; matches the value passed to SourcePicker.onSelect.
 *        — 稳定标识符, 与传给 onSelect 的值匹配.
 * `name` - Human-readable source name shown in the button.
 *         — 按钮中显示的可读来源名称.
 * `durationMs` - Optional probe round-trip time in milliseconds; used for sorting and latency badge.
 *              — 可选的探测往返时间 (毫秒); 用于排序和延迟徽标.
 * `status` - Detail fetch state; tracked by the parent (DetailPage) and forwarded here
 *            for future use. Not currently read by SourcePicker's own rendering logic.
 *            — detail 获取状态; 由父级 (DetailPage) 追踪并转发. 当前 SourcePicker 渲染逻辑不读取此字段.
 */
export interface SourcePickerItem {
  key: string;
  name: string;
  durationMs?: number;
  status: SourcePickerStatus;
}

/**
 * SourcePicker renders the source selection list for the detail page sidebar.
 * SourcePicker 渲染详情页侧边栏的来源选择列表.
 *
 * Sources are sorted fastest-first by durationMs (undefined/zero treated as unknown/slowest).
 * When more than 8 sources exist, a toggle collapses the overflow.
 * 来源按 durationMs 由快到慢排序 (undefined/0 视为未知/最慢).
 * 超过 8 个来源时折叠溢出部分, 提供切换按钮.
 *
 * @param sources - The list of source items to display — 要显示的来源条目列表
 * @param selectedKey - The key of the currently active source — 当前活动来源的 key
 * @param onSelect - Called with the source key when the user clicks a different source — 用户切换来源时以来源 key 调用
 */
export function SourcePicker({
  sources,
  selectedKey,
  onSelect,
}: {
  sources: SourcePickerItem[];
  selectedKey: string;
  onSelect(key: string): void;
}) {
  const { t } = useTranslation("viewer");
  const [showAll, setShowAll] = useState(false);
  // Sort is deferred to useMemo so rapid source list updates don't re-sort on every render.
  // 排序延迟到 useMemo, 避免来源列表频繁更新时每次渲染都重新排序.
  const sortedSources = useMemo(() => [...sources].sort(compareByLatency), [sources]);
  const hasMoreSources = sortedSources.length > visibleSourceLimit;
  const visibleSources = showAll || !hasMoreSources ? sortedSources : sortedSources.slice(0, visibleSourceLimit);

  return (
    <section className="detail-control-panel">
      <h2>{t("detail.sourcePickerHeading")}</h2>
      <div className="source-picker">
        {visibleSources.map((source) => {
          const latency = latencyLabel(source.durationMs, t("detail.sourceLatencyUnknown"));
          return (
            <button
              className={source.key === selectedKey ? "source-button active" : "source-button"}
              key={source.key}
              type="button"
              aria-label={t("detail.sourcePickerAria", { name: source.name, latency: latency.label })}
              aria-pressed={source.key === selectedKey}
              onClick={() => onSelect(source.key)}
            >
              <span className="source-name">{source.name}</span>
              <span className={`source-latency ${latency.className}`}>{latency.label}</span>
            </button>
          );
        })}
        {hasMoreSources ? (
          <button className="source-picker-toggle" type="button" onClick={() => setShowAll((current) => !current)}>
            {showAll ? t("detail.showLess") : t("detail.showMore")}
          </button>
        ) : null}
      </div>
    </section>
  );
}

// compareByLatency sorts sources so the fastest (lowest durationMs) come first.
// Undefined or zero durationMs (probe not run or failed) is treated as unknown and sorted last.
// compareByLatency 将来源按延迟由快到慢排序.
// durationMs 为 undefined 或 0 时 (探测未运行或失败) 视为未知并排在最后.
function compareByLatency(a: SourcePickerItem, b: SourcePickerItem): number {
  const aValid = typeof a.durationMs === "number" && a.durationMs > 0;
  const bValid = typeof b.durationMs === "number" && b.durationMs > 0;
  if (aValid && bValid) return a.durationMs! - b.durationMs!;
  if (aValid) return -1;
  if (bValid) return 1;
  return 0;
}

/**
 * latencyLabel converts a raw probe duration into a human-readable label and CSS class tier.
 * latencyLabel 将原始探测时长转换为可读标签和 CSS 分级类名.
 *
 * Tiers / 分级:
 *   < 1 s  → "Xms"  / source-latency-good
 *   1–3 s  → "X.Xs" / source-latency-warn
 *   ≥ 3 s  → "X.Xs" / source-latency-bad
 *   unknown → unknownLabel / source-latency-unknown
 *
 * Exported for unit testing (Tier 2 — same-module export, logged in wave contract).
 * 为单元测试导出 (Tier 2 — 同模块导出, 已记录在 wave 合约日志中).
 */
export function latencyLabel(durationMs: number | undefined, unknownLabel: string): { label: string; className: string } {
  if (typeof durationMs !== "number" || durationMs <= 0) {
    return { label: unknownLabel, className: "source-latency-unknown" };
  }
  const label = durationMs < 1000 ? `${Math.round(durationMs)}ms` : `${(durationMs / 1000).toFixed(1)}s`;
  if (durationMs < 1000) {
    return { label, className: "source-latency-good" };
  }
  if (durationMs < 3000) {
    return { label, className: "source-latency-warn" };
  }
  return { label, className: "source-latency-bad" };
}
