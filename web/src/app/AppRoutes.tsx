/**
 * AppRoutes — top-level route tree with auth-gated rendering and per-route lazy loading.
 * AppRoutes — 顶层路由树, 包含基于认证状态的渲染控制和按路由懒加载.
 *
 * Routing model / 路由模型:
 *   - /login  — always rendered without AppLayout; authenticated users are bounced to /.
 *   - unauthenticated status — wildcard redirects every path to /login.
 *   - anonymous + authenticated — AppLayout wraps lazy pages with AnimatePresence transitions.
 *
 * TIER 4 LOCKED — route paths ("/", "/search", "/detail/:token", "/favorites",
 * "/account", "/admin", "/login") must not change. "/settings" is a legacy alias that
 * redirects to "/account" and must also remain for backward compatibility.
 * Bookmarks and Apple client integrations depend on these exact paths.
 * TIER 4 锁定 — 路由路径不得修改. "/settings" 是重定向到 "/account" 的兼容别名,
 * 同样必须保留. 书签和 Apple 客户端集成依赖这些确切路径.
 *
 * Detail path change (ADR-015) / 详情页路径变更 (ADR-015):
 *   The detail route was previously /detail/:source/:id which exposed third-party
 *   source domains in the URL. It is now /detail/:token where token is an opaque
 *   base64url encoding of (source_key, video_id) — see storage/detailRoute.ts.
 *   Legacy /detail/:source/:id URLs are intentionally NOT redirected; old shared
 *   links 404 to "/" via the wildcard fallback.
 *   详情路由原为 /detail/:source/:id, 会在 URL 中暴露第三方源域名. 现改为 /detail/:token,
 *   token 为 (source_key, video_id) 的 base64url 不透明编码 — 详见 storage/detailRoute.ts.
 *   旧 /detail/:source/:id 链接刻意不做重定向, 会被通配符兜底路由到 "/".
 *
 * Key exports / 主要导出:
 *   AppRoutes
 *
 * Callers / 调用方:
 *   AppShell.tsx (production) — mounted inside BootGate so status is never "probing" here.
 *   AppShell.tsx (生产) — 挂载在 BootGate 内, 因此这里的 status 绝不会是 "probing".
 *   Integration tests may mount AppRoutes directly with a MemoryRouter + AuthProvider harness.
 *   集成测试可能直接用 MemoryRouter + AuthProvider harness 挂载 AppRoutes.
 */

import { Suspense } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { useAuth } from "@/auth/AuthContext";
import { reducedMotionTransition, transitions } from "@/animation/motionPresets";
import { LoginPage } from "@/auth/LoginPage";

import { AppLayout } from "./AppLayout";
import { lazyWithReload } from "./lazyWithReload";
import { RouteSkeleton } from "./RouteSkeleton";

// Route-level lazy chunks — each page is split into a separate bundle so the
// initial load only ships the shell + auth logic. lazyWithReload adds a one-shot
// reload recovery when a stale chunk URL fails after a server rebuild.
// 路由级懒加载分包 — 每个页面单独分包, 初始加载只传输外壳和认证逻辑.
// lazyWithReload 在服务端重建后 chunk URL 失效时提供一次性刷新恢复机制.
const HomePage = lazyWithReload(() => import("@/viewer/home/HomePage").then((m) => ({ default: m.HomePage })));
const SearchPage = lazyWithReload(() => import("@/viewer/search/SearchPage").then((m) => ({ default: m.SearchPage })));
const DetailPage = lazyWithReload(() => import("@/viewer/detail/DetailPage").then((m) => ({ default: m.DetailPage })));
const FavoritesPage = lazyWithReload(() => import("@/viewer/favorites/FavoritesPage").then((m) => ({ default: m.FavoritesPage })));
const AccountPage = lazyWithReload(() => import("@/account/AccountPage").then((m) => ({ default: m.AccountPage })));
const AdminPage = lazyWithReload(() => import("@/admin/AdminPage").then((m) => ({ default: m.AdminPage })));

/**
 * AppRoutes renders the correct route subtree based on the current auth status and path.
 * AppRoutes 根据当前认证状态和路径渲染对应的路由子树.
 *
 * Called inside BootGate, so status is guaranteed to be "anonymous", "authenticated",
 * or "unauthenticated" — never "probing".
 * 在 BootGate 内调用, 因此 status 必为 "anonymous"、"authenticated" 或 "unauthenticated",
 * 绝不会是 "probing".
 */
export function AppRoutes() {
  const auth = useAuth();
  const location = useLocation();
  // isDetailRoute collapses all /detail/:token variants to a single AnimatePresence key
  // so episode and source switches within the detail page do not trigger an exit animation.
  // isDetailRoute 将所有 /detail/:token 变体折叠到同一 AnimatePresence key,
  // 避免在详情页内切换剧集或片源时触发退出动画.
  const isDetailRoute = location.pathname.startsWith("/detail/");
  const reduceMotion = useReducedMotion() ?? false;
  // Respect the OS-level "reduce motion" accessibility preference.
  // 遵从操作系统级别的「减少动态效果」无障碍偏好设置.
  const transition = reduceMotion ? reducedMotionTransition : transitions.pageSlide;

  // /login is rendered bare (no AppLayout) so the login screen owns the viewport.
  // Authenticated users never need it — bounce them back to /. Anonymous and
  // unauthenticated users both render the form here.
  // /login 始终以无 AppLayout 的形式渲染, 让登录页独占视口; 已登录用户直接弹回 /.
  if (location.pathname === "/login") {
    if (auth.isAuthenticated) {
      return <Navigate to="/" replace />;
    }
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    );
  }

  if (auth.status.kind === "unauthenticated") {
    return (
      <Routes>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // anonymous or authenticated, not on /login.
  return (
    <AppLayout>
      <Suspense fallback={<RouteSkeleton />}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={isDetailRoute ? "__detail__" : location.pathname}
            className="route-frame"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={transition}
          >
            <Routes location={location}>
              <Route path="/" element={<HomePage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/detail/:token" element={<DetailPage />} />
              <Route path="/favorites" element={<FavoritesPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="/settings" element={<Navigate to="/account" replace />} />
              <Route
                path="/admin"
                element={auth.user?.role === "admin" ? <AdminPage /> : <Navigate to="/" replace />}
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </Suspense>
    </AppLayout>
  );
}
