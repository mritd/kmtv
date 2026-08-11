/**
 * app/ScrollToTop.tsx — returns the viewport to the top when a route is navigated into.
 *
 * app/ScrollToTop.tsx — 进入新路由时把视口拉回顶部.
 *
 * Responsibilities / 职责:
 *   - Scroll the window to the top on PUSH/REPLACE navigation — PUSH/REPLACE 导航时将窗口滚到顶部
 *   - Leave POP navigation alone so back/forward keeps the browser's own position
 *
 *     — POP 导航不做处理, 让前进/后退保留浏览器自身的位置
 *
 * Key exports / 主要导出:
 *   ScrollToTop
 *
 * Callers / 调用方:
 *   app/AppShell.tsx — rendered inside BrowserRouter alongside the route tree
 *
 * Why this exists / 存在原因:
 *   The app scrolls the window, not an inner container, and a SPA route change does not
 *   reset that. Opening a title from halfway down the search results therefore landed on
 *   the detail page still scrolled, with the player's top edge behind the sticky nav.
 *
 *   本应用滚动的是 window 而非内层容器, 而 SPA 路由切换不会重置它.
 *   因此从搜索结果中部点开一个片子, 进入详情页时仍保持着原来的滚动量,
 *   播放器上边缘被吸顶导航挡住.
 *
 *   React Router's own <ScrollRestoration> is not an option here: it only works under a
 *   data router (createBrowserRouter), and this app mounts a plain <BrowserRouter>.
 *
 *   React Router 自带的 <ScrollRestoration> 在这里不可用: 它只在 data router
 *   (createBrowserRouter) 下生效, 而本应用挂载的是普通 <BrowserRouter>.
 */

import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * ScrollToTop renders nothing and only reacts to navigation.
 *
 * ScrollToTop 不渲染任何内容, 仅对导航做出反应.
 *
 * POP covers both the back/forward buttons and the very first render — React Router
 * reports the initial navigation as POP — so a reload keeps whatever position the
 * browser restored instead of being yanked to the top.
 *
 * POP 同时涵盖前进/后退按钮与首次渲染 — React Router 将初始导航报告为 POP —
 * 因此刷新页面会保留浏览器恢复的位置, 而不会被拽回顶部.
 */
export function ScrollToTop() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (navigationType === "POP") {
      return;
    }
    window.scrollTo(0, 0);
  }, [pathname, navigationType]);

  return null;
}
