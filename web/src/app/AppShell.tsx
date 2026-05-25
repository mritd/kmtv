/**
 * AppShell — root composition component that wires every provider together.
 * AppShell — 根组合组件, 将所有 Provider 串联成完整的应用上下文树.
 *
 * Responsibilities / 职责:
 *   - Create the module-level singleton TokenStore (one cross-tab storage listener) — 创建模块级单例 TokenStore (一个跨标签存储监听)
 *   - Build the APIClient and QueryClient with stable identities across renders — 构建在渲染间保持稳定引用的 APIClient 和 QueryClient
 *   - Layer ThemeProvider → APIProvider → QueryClientProvider → AuthProvider → BrowserRouter — 叠加各 Provider 层
 *   - Mount SessionExpiredBridge for toast notifications on 401/logout — 挂载 SessionExpiredBridge 以显示 401/登出 Toast
 *   - Gate rendering via BootGate (hides children while AuthStatus is "probing") — 通过 BootGate 屏蔽渲染 (AuthStatus 为 probing 时隐藏子树)
 *
 * Key exports / 主要导出:
 *   AppShell
 *
 * Callers / 调用方:
 *   App.tsx — instantiates AppShell without props in production
 *   App.test.tsx — passes test-controlled tokenStore and apiClient for integration tests
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BrowserRouter } from "react-router-dom";

import { createAPIClient, type APIClient } from "@/api/client";
import { APIProvider } from "@/api/context";
import type { TokenStore } from "@/api/tokenStore";
import { createLocalTokenStore } from "@/api/tokenStore";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { ToastContainer, useSessionExpiredToast } from "@/shared/ui/Toast";

import { AppRoutes } from "./AppRoutes";
import { BootGate } from "./BootGate";

// defaultTokenStore is a module-level singleton that attaches the cross-tab storage
// listener exactly once per page lifetime. Defining it at module scope prevents the
// window "storage" event handler from being attached on every React render when the
// prop defaults are evaluated (which happens with function default arguments).
// defaultTokenStore 是模块级单例, 每个页面生命周期只注册一次跨标签存储监听.
// 在模块作用域定义可避免将其写在函数默认参数中时每次 React 渲染都执行 createLocalTokenStore
// 进而重复注册 window "storage" 事件处理器.
const defaultTokenStore: TokenStore = createLocalTokenStore();

// SessionExpiredBridge bridges AuthContext's lastClearReason into the Toast system.
// It must be mounted inside AuthProvider (to call useAuth) but outside QueryClientProvider
// is fine — it has no data-fetching concern of its own.
// SessionExpiredBridge 将 AuthContext 的 lastClearReason 桥接到 Toast 系统.
// 必须挂载在 AuthProvider 内部 (以调用 useAuth), 无需在 QueryClientProvider 内.
function SessionExpiredBridge() {
  const auth = useAuth();
  const { t } = useTranslation("auth");
  useSessionExpiredToast(auth.lastClearReason, t("sessionExpired"));
  return null;
}

/**
 * AppShell is the root component rendered by App.tsx. It accepts optional overrides for
 * testing — pass a `tokenStore` and `apiClient` in tests to control auth state and network.
 * AppShell 是 App.tsx 渲染的根组件. 接受可选的测试覆盖参数 —
 * 在测试中传入 tokenStore 和 apiClient 以控制认证状态和网络行为.
 *
 * The stable `[]` dependency on `queryClient` is intentional: the QueryClient must be
 * created once per AppShell mount and never replaced (replacing invalidates all caches).
 * queryClient 的稳定 `[]` 依赖是有意为之: QueryClient 必须在 AppShell 挂载时创建一次,
 * 不可替换 (替换会使所有缓存失效).
 */
export function AppShell({
  tokenStore = defaultTokenStore,
  apiClient,
}: {
  tokenStore?: TokenStore;
  apiClient?: APIClient;
}) {
  // api is memoised on apiClient+tokenStore; in production both are stable across renders.
  // api 对 apiClient+tokenStore 进行 memo 化; 生产环境中二者在渲染间均保持稳定.
  const api = useMemo(() => apiClient ?? createAPIClient({ tokenStore }), [apiClient, tokenStore]);
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 30 s stale window reduces refetch noise on tab focus without staling data.
            // 30 秒 stale 窗口在减少 tab 聚焦时重新请求的同时不会使数据过于陈旧.
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
    [],
  );

  return (
    <ThemeProvider>
      <APIProvider value={api}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider api={api} tokenStore={tokenStore} queryClient={queryClient}>
            <BrowserRouter>
              <SessionExpiredBridge />
              <BootGate>
                <AppRoutes />
              </BootGate>
            </BrowserRouter>
            <ToastContainer />
          </AuthProvider>
        </QueryClientProvider>
      </APIProvider>
    </ThemeProvider>
  );
}
