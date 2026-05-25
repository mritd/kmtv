import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";

import { createAPIClient } from "@/api/client";
import { APIProvider } from "@/api/context";
import { createMemoryTokenStore } from "@/api/tokenStore";
import { AppRoutes } from "@/app/AppRoutes";
import { AuthProvider } from "@/auth/AuthContext";

// makeFetcher returns a typed fake fetch that maps URL paths to JSON responses.
// makeFetcher
// 返回按路径映射的假 fetch.
function makeFetcher(responses: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(url, "http://localhost").pathname;
    const body = responses[path] ?? {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("cross-user data leak", () => {
  test("admin logout then user login does not show previous-user data", async () => {
    const tokenStore = createMemoryTokenStore();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetcher = makeFetcher({
      "/api/v1/admin/sources": {
        sources: [
          {
            id: 1,
            key: "ADMIN_SECRET",
            name: "secret",
            api: "",
            detail: "",
            enabled: true,
            searchable: true,
            comment: "",
            health: "healthy",
            last_check: "",
            created_at: "",
            updated_at: "",
          },
        ],
      },
      "/api/v1/douban/home": { sections: [] },
    });
    const api = createAPIClient({ tokenStore, fetcher });

    // Seed admin auth and prefetch admin sources cache.
    // 预热管理员认证和源缓存.
    tokenStore.set({
      accessToken: "a",
      expiresAt: "2099-01-01T00:00:00Z",
      user: { id: 1, username: "admin", role: "admin" },
    });
    await queryClient.prefetchQuery({
      queryKey: ["admin", "sources"],
      queryFn: () => api.listSources(),
    });
    expect(queryClient.getQueryData(["admin", "sources"])).toBeTruthy();

    render(
      <APIProvider value={api}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider api={api} tokenStore={tokenStore} queryClient={queryClient}>
            <MemoryRouter>
              <AppRoutes />
            </MemoryRouter>
          </AuthProvider>
        </QueryClientProvider>
      </APIProvider>,
    );

    // Logout:
    // identity becomes null and the lifecycle effect clears user-scoped state.
    // 退出登录: 身份变为空, 生命周期副作用清理用户作用域状态.
    tokenStore.clear("logout");
    await waitFor(() => expect(queryClient.getQueryData(["admin", "sources"])).toBeUndefined());

    // Re-login as a non-admin user.
    // 以普通用户重新登录.
    tokenStore.set({
      accessToken: "b",
      expiresAt: "2099-01-01T00:00:00Z",
      user: { id: 2, username: "viewer", role: "user" },
    });
    // Stronger leak assertions:
    // the whole cache must be empty and the admin secret must not appear anywhere in DOM (visible or hidden).
    // 更严格的泄漏断言: 整个缓存为空, 且 admin 秘密在 DOM 任何位置 (可见或隐藏) 都不出现.
    await waitFor(() => expect(queryClient.getQueryCache().findAll({ queryKey: ["admin"] }).length).toBe(0));
    expect(document.body.innerHTML).not.toContain("ADMIN_SECRET");
  });

  test("eventual isolation holds across an immediate logout-then-login race", async () => {
    // This test does NOT waitFor between clear and re-set, so the second identity transition lands while the first reset may still be in-flight.
    // 该测试在 clear 和 re-set 之间不等待, 第二次身份变更可能与第一次重置并发.
    const tokenStore = createMemoryTokenStore();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetcher = makeFetcher({
      "/api/v1/admin/sources": {
        sources: [{ id: 1, key: "ADMIN_SECRET", name: "secret", api: "", detail: "", enabled: true, searchable: true, comment: "", health: "healthy", last_check: "", created_at: "", updated_at: "" }],
      },
      "/api/v1/douban/home": { sections: [] },
    });
    const api = createAPIClient({ tokenStore, fetcher });

    tokenStore.set({ accessToken: "a", expiresAt: "2099-01-01T00:00:00Z", user: { id: 1, username: "admin", role: "admin" } });
    await queryClient.prefetchQuery({ queryKey: ["admin", "sources"], queryFn: () => api.listSources() });

    render(
      <APIProvider value={api}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider api={api} tokenStore={tokenStore} queryClient={queryClient}>
            <MemoryRouter>
              <AppRoutes />
            </MemoryRouter>
          </AuthProvider>
        </QueryClientProvider>
      </APIProvider>,
    );

    // Race window:
    // clear and re-set in the same microtask.
    // 竞态窗口: 同一微任务内 clear 然后 set.
    tokenStore.clear("logout");
    tokenStore.set({ accessToken: "b", expiresAt: "2099-01-01T00:00:00Z", user: { id: 2, username: "viewer", role: "user" } });

    // Eventually the cache must be cleared and no admin data appears.
    // 最终缓存必须被清空, 且 admin 数据不出现.
    await waitFor(() => expect(queryClient.getQueryCache().findAll({ queryKey: ["admin"] }).length).toBe(0));
    expect(document.body.innerHTML).not.toContain("ADMIN_SECRET");
  });
});
