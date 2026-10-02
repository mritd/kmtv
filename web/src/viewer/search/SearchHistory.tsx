/**
 * SearchHistory — recent search chips shown on the search page before a query is active.
 *
 * SearchHistory — 搜索页在没有进行中的查询时显示的最近搜索标签.
 *
 * Pure presentation: the parent reads the sync store and handles selection and clearing.
 *
 * 纯展示组件: 父组件读取同步存储, 并处理选择与清空.
 */
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/ui/Button";

/**
 * SearchHistoryProps are the queries to show and the two user actions.
 *
 * SearchHistoryProps 是要显示的搜索词以及两个用户操作.
 */
export interface SearchHistoryProps {
  items: readonly string[];
  onSelect(query: string): void;
  onClear(): void;
}

/**
 * SearchHistory renders recent queries as chips with a clear action, or nothing when empty.
 *
 * SearchHistory 将最近搜索渲染为可点击标签并提供清空操作, 为空时不渲染.
 */
export function SearchHistory({ items, onSelect, onClear }: SearchHistoryProps) {
  const { t } = useTranslation("viewer");
  if (items.length === 0) return null;
  return (
    <section className="search-history" aria-label={t("search.history.title")}>
      <div className="search-history-heading">
        <h2>{t("search.history.title")}</h2>
        <Button type="button" variant="ghost" onClick={onClear}>
          {t("search.history.clear")}
        </Button>
      </div>
      <ul className="category-chip-row search-history-list">
        {items.map((query) => (
          <li key={query}>
            <button type="button" className="category-chip" onClick={() => onSelect(query)}>
              {query}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
