// StatusState — full-section status indicator for loading, error, and neutral states.
// StatusState — 用于加载中、错误和中性状态的全区域状态提示组件.
//
// Exports: StatusState.
// Callers: search page (loading/error), detail page (error), any page that needs a prominent status message.
// 调用者: 搜索页(加载/错误)、详情页(错误)、需要显示醒目状态信息的页面.
//
// Differs from EmptyState in that StatusState carries a semantic tone (error, loading, default)
// which is reflected as a CSS modifier class on the root element, enabling tone-specific styling.
// 与 EmptyState 的区别在于 StatusState 携带语义色调 (error/loading/default),
// 该色调作为 CSS 修饰符类应用到根元素, 允许针对不同色调定制样式.

import type { ReactNode } from "react";

// StatusTone controls the visual and semantic variant of the StatusState component.
// StatusTone 控制 StatusState 组件的视觉和语义变体.
//   "default"  — neutral informational state / 中性信息状态
//   "error"    — something went wrong / 发生错误
//   "loading"  — operation in progress / 操作进行中
type StatusTone = "default" | "error" | "loading";

// StatusStateProps defines the display contract for StatusState.
// StatusStateProps 定义 StatusState 的显示接口.
interface StatusStateProps {
  // title is the primary heading shown to the user.
  // title 是展示给用户的主标题.
  title: string;
  // description provides additional context below the title (optional).
  // description 在标题下方提供附加说明 (可选).
  description?: string;
  // action renders a call-to-action element below the description (optional).
  // action 在描述下方渲染行动引导元素 (可选).
  action?: ReactNode;
  // tone controls the CSS modifier class for visual theming. Defaults to "default".
  // tone 控制用于视觉主题化的 CSS 修饰符类, 默认为 "default".
  tone?: StatusTone;
}

// StatusState renders a centred status section with a tone-keyed CSS modifier class.
// StatusState 渲染一个带色调 CSS 修饰符的居中状态区域.
export function StatusState({ title, description, action, tone = "default" }: StatusStateProps): React.JSX.Element {
  return (
    <section className={`status-state status-state-${tone}`}>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {action ? <div>{action}</div> : null}
    </section>
  );
}
