// EmptyState — full-section placeholder for when a list or data set has no items.
// EmptyState — 列表或数据集为空时的全区域占位组件.
//
// Exports: EmptyState.
// Callers: favorites page, search page (no results), source list, subscription list.
// 调用者: 收藏页、搜索页(无结果)、源列表、订阅列表.
//
// Renders a <section> containing a heading, optional description paragraph, and optional action slot.
// The action slot is commonly a CTA button to help the user recover from the empty state.
// 渲染一个包含标题、可选描述段落和可选操作插槽的 <section>.
// 操作插槽通常为 CTA 按钮, 引导用户从空状态中恢复.

import type { ReactNode } from "react";

// EmptyStateProps defines the display contract for EmptyState.
// EmptyStateProps 定义 EmptyState 的显示接口.
interface EmptyStateProps {
  // title is the primary heading shown to the user (e.g. "No favorites yet").
  // title 是展示给用户的主标题 (如 "暂无收藏").
  title: string;
  // description provides additional context below the title (optional).
  // description 在标题下方提供附加说明 (可选).
  description?: string;
  // action renders a call-to-action element below the description (optional).
  // action 在描述下方渲染行动引导元素 (可选).
  action?: ReactNode;
}

// EmptyState renders a centred placeholder section for empty data states.
// EmptyState 渲染一个居中的空数据状态占位区域.
export function EmptyState({ title, description, action }: EmptyStateProps): React.JSX.Element {
  return (
    <section className="empty-state">
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </section>
  );
}
