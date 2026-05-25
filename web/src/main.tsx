/**
 * main.tsx — application boot entry point.
 * main.tsx — 应用启动入口.
 *
 * This file is intentionally minimal: it imports the i18n side-effect initialiser,
 * global styles, and the root App component, then mounts the React tree into #root.
 * 此文件故意保持最简: 导入 i18n 副作用初始化、全局样式和根 App 组件,
 * 然后将 React 树挂载到 #root 元素.
 *
 * StrictMode is enabled in all environments (including production builds) to surface
 * double-invocation issues and deprecated lifecycle warnings during development.
 * 所有环境 (包括生产构建) 均启用 StrictMode, 以在开发阶段暴露双调用问题和弃用生命周期警告.
 *
 * NOTE: this file is excluded from vitest (see vitest.config.ts coverage.exclude).
 * It is exercised end-to-end by the browser, not by unit tests.
 * 注意: 此文件已从 vitest 中排除 (见 vitest.config.ts coverage.exclude).
 * 它由浏览器端到端执行, 而非单元测试.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./i18n";
import "./style.css";

// Fail fast if the host page is missing the #root anchor — a missing element means
// index.html has been modified incorrectly and there is nothing useful we can render.
// 如果宿主页面缺少 #root 锚点则快速失败 — 缺少元素意味着 index.html 被错误修改,
// 没有任何有用的内容可以渲染.
const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing root element");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
