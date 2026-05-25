/**
 * adminHooks — React Query hooks for admin-only API resources.
 * adminHooks — 管理员专用 API 资源的 React Query hooks.
 *
 * Responsibilities / 职责:
 *   - Fetch and cache sources, subscriptions, users, and settings — 获取并缓存源、订阅、用户和配置
 *   - Provide mutation hooks for source health-check operations — 提供源健康检查操作的 mutation hooks
 *   - Invalidate related caches after mutations — mutation 后使相关缓存失效
 *
 * Key exports / 主要导出:
 *   useSourcesQuery, useSubscriptionsQuery, useUsersQuery,
 *   useAdminSettingsQuery, useCheckSourceMutation
 *
 * Callers / 调用方:
 *   admin/AdminPage.tsx, admin/panels/*, admin/forms/*
 *
 * React Query key contract (TIER 4 LOCKED — callers invalidate by these exact keys):
 *   ["admin", "sources"] — sources list
 *   ["admin", "subscriptions"] — subscriptions list
 *   ["admin", "users"] — users list
 *   ["admin", "settings"] — settings map
 * Tier 4 锁定 — 调用方通过这些精确 key 触发缓存失效, 不得更改.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAPI } from "./context";

// POLLING_INTERVAL_MS is the refetch interval while at least one source is mid-probe.
// Chosen as 2 s to reflect probe progress promptly without hammering the server.
// POLLING_INTERVAL_MS
// 是至少有一个源处于探测中时的轮询间隔.
// 选择 2 秒既能及时反映探测进度, 又不会频繁请求服务器.
const POLLING_INTERVAL_MS = 2000;

/**
 * useSourcesQuery fetches the list of all configured video sources.
 * useSourcesQuery
 * 获取所有已配置视频源的列表.
 *
 * Automatically polls every 2 s while any source reports health === "checking",
 * so the admin UI reflects probe progress without requiring SSE.
 * 当任一源的 health === "checking" 时自动每 2 秒轮询, 让管理面板无需 SSE 即可看到探测进度.
 */
export function useSourcesQuery() {
  const api = useAPI();
  return useQuery({
    queryKey: ["admin", "sources"],
    queryFn: () => api.listSources(),
    // Poll while any source is mid-probe so the admin UI reflects progress without SSE.
    // 任一源处于探测中时轮询, 让管理面板能看到进度而不依赖 SSE.
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return false;
      return data.sources.some((s) => s.health === "checking") ? POLLING_INTERVAL_MS : false;
    },
  });
}

/**
 * useSubscriptionsQuery fetches the list of all subscription records.
 * useSubscriptionsQuery
 * 获取所有订阅记录的列表.
 */
export function useSubscriptionsQuery() {
  const api = useAPI();
  return useQuery({ queryKey: ["admin", "subscriptions"], queryFn: () => api.listSubscriptions() });
}

/**
 * useUsersQuery fetches the list of all registered users (admin-only).
 * useUsersQuery
 * 获取所有注册用户的列表 (仅限管理员).
 */
export function useUsersQuery() {
  const api = useAPI();
  return useQuery({ queryKey: ["admin", "users"], queryFn: () => api.listUsers() });
}

/**
 * useAdminSettingsQuery fetches the flat settings key-value map from /settings.
 * useAdminSettingsQuery
 * 从 /settings 获取扁平键值配置映射.
 *
 * Unlike the viewer settings query, this version is keyed under "admin"
 * so admin form mutations can invalidate it without affecting viewer caches.
 * 与观看者配置查询不同, 此版本 key 在 "admin" 下, 使管理表单 mutation 可以单独失效而不影响观看者缓存.
 */
export function useAdminSettingsQuery() {
  const api = useAPI();
  return useQuery({ queryKey: ["admin", "settings"], queryFn: () => api.getSettings() });
}

/**
 * useCheckSourceMutation triggers a health-check probe for a single source by ID.
 * useCheckSourceMutation
 * 通过 ID 触发单个视频源的健康检查探测.
 *
 * On success, invalidates the sources list so the admin UI picks up the new health status.
 * 成功后使源列表缓存失效, 让管理 UI 获取到最新的健康状态.
 */
export function useCheckSourceMutation() {
  const api = useAPI();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.checkSource(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin", "sources"] }),
  });
}
