// PageHeader — top-of-page header layout with eyebrow, title, description, and action slot.
// PageHeader — 页面顶部标题布局, 包含眉题、主标题、描述和操作插槽.
//
// Exports: PageHeader.
// Callers: admin panel pages, account settings page, and any page that needs a consistent page-level header.
// 调用者: 管理面板页面、账户设置页面, 以及需要统一页面级标题的页面.
//
// Layout structure (left-to-right / flex-row):
//   [eyebrow?] [h1 title] [description?]   |   [action?]
// The left block stacks vertically; the right action block is flex-pinned to the end.
// 布局结构 (横向 flex): 左侧纵向堆叠眉题/主标题/描述; 右侧操作区 flex 对齐末端.

import type { ReactNode } from "react";

// PageHeaderProps defines the display contract for PageHeader.
// PageHeaderProps 定义 PageHeader 的显示接口.
interface PageHeaderProps {
  // eyebrow is a short label rendered above the title (e.g. a category or section name).
  // eyebrow 是渲染在标题上方的简短标签 (如分类名或区块名).
  eyebrow?: string;
  // title is the primary h1 heading of the page.
  // title 是页面的主 h1 标题.
  title: string;
  // description provides a subtitle or explanatory text below the title (optional).
  // description 在标题下方提供副标题或说明文字 (可选).
  description?: string;
  // action renders an action element (e.g. a button) aligned to the trailing edge of the header (optional).
  // action 渲染对齐到标题末端的操作元素 (如按钮, 可选).
  action?: ReactNode;
}

// PageHeader renders the standard page-level header used across admin and account pages.
// PageHeader 渲染管理和账户页面通用的标准页面级标题.
export function PageHeader({ eyebrow, title, description, action }: PageHeaderProps): React.JSX.Element {
  return (
    <section className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <div className="heading-block">
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      {action ? <div className="page-header-action">{action}</div> : null}
    </section>
  );
}
