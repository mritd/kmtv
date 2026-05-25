/**
 * RouteSkeleton — Suspense fallback for lazy-loaded route chunks in AppRoutes.
 * RouteSkeleton — 用于 AppRoutes 中懒加载路由分包的 Suspense fallback.
 *
 * Each route path maps to the matching per-page skeleton component wrapped in the same
 * outer `<main>` container class that the real page uses. This prevents a layout jump
 * when the chunk loads and the real page component mounts. Mismatched containers cause
 * visible content reflow (padding/margin changes), which degrades perceived performance.
 * 每个路由路径映射到与真实页面使用相同外层 `<main>` 容器类的骨架组件.
 * 这可防止 chunk 加载完毕真实页面组件挂载时发生布局抖动.
 * 容器类不匹配会导致可见的内容重排 (padding/margin 变化), 降低感知性能.
 *
 * Key exports / 主要导出:
 *   RouteSkeleton
 *
 * Callers / 调用方:
 *   AppRoutes.tsx — used as the Suspense fallback prop
 */

import { useLocation } from "react-router-dom";

import { AccountSkeleton } from "@/account/AccountSkeleton";
import { AdminTableSkeleton } from "@/admin/skeletons/AdminTableSkeleton";
import { DetailSkeleton } from "@/viewer/skeletons/DetailSkeleton";
import { FavoritesSkeleton } from "@/viewer/skeletons/FavoritesSkeleton";
import { HomeSkeleton } from "@/viewer/skeletons/HomeSkeleton";
import { SearchSkeleton } from "@/viewer/skeletons/SearchSkeleton";

/**
 * RouteSkeleton renders the route-appropriate skeleton inside the matching container.
 * RouteSkeleton 在与路由匹配的容器内渲染对应的骨架屏组件.
 *
 * Container class invariant: the `className` on `<main>` must stay in sync with
 * the destination page component. If a page's outer class changes, update this
 * function to match — otherwise users will see a layout jump during chunk load.
 * 容器类不变量: `<main>` 上的 `className` 必须与目标页面组件保持同步.
 * 如果页面外层类变更, 需同步更新此函数, 否则 chunk 加载期间会出现布局抖动.
 */
export function RouteSkeleton() {
  const { pathname } = useLocation();

  if (pathname === "/" || pathname === "") {
    return (
      <main className="home-page" aria-busy="true" aria-label="Loading">
        <HomeSkeleton />
      </main>
    );
  }
  if (pathname.startsWith("/search")) {
    return (
      <main className="page search-page search-page-redesign" aria-busy="true" aria-label="Loading">
        <section className="search-workspace">
          <div className="search-main-column">
            <SearchSkeleton />
          </div>
        </section>
      </main>
    );
  }
  if (pathname.startsWith("/detail/")) {
    return (
      <main className="page detail-page" aria-busy="true" aria-label="Loading">
        <DetailSkeleton />
      </main>
    );
  }
  if (pathname.startsWith("/admin")) {
    return (
      <main className="page admin-page" aria-busy="true" aria-label="Loading">
        <AdminTableSkeleton />
      </main>
    );
  }
  if (pathname.startsWith("/favorites")) {
    return (
      <main className="page favorites-page" aria-busy="true" aria-label="Loading">
        <FavoritesSkeleton />
      </main>
    );
  }
  if (pathname.startsWith("/account") || pathname.startsWith("/settings")) {
    return (
      <main className="page account-page" aria-busy="true" aria-label="Loading">
        <AccountSkeleton />
      </main>
    );
  }
  // Fallback for unknown routes — minimal placeholder that does not impose any
  // specific page geometry, to avoid jumping when the real page mounts.
  // 未知路由 fallback — 最小占位, 不强加任何具体页面几何, 避免真实页面挂载时跳动.
  return <main className="page" aria-busy="true" aria-label="Loading" />;
}
