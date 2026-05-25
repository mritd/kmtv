/**
 * useSubscriptionsMutations — React Query mutation hooks for all subscription CRUD operations.
 * useSubscriptionsMutations — 所有订阅 CRUD 操作的 React Query mutation hooks.
 *
 * Responsibilities / 职责:
 *   - Provide create, update, remove, sync mutations — 提供 create/update/remove/sync mutations
 *   - Invalidate the ["admin", "subscriptions"] cache after every successful mutation
 *     每次成功 mutation 后使 ["admin", "subscriptions"] 缓存失效
 *
 * Key exports / 主要导出:
 *   useSubscriptionsMutations
 *
 * Callers / 调用方:
 *   admin/forms/SubscriptionForm.tsx
 *   admin/SubscriptionsPanel.tsx
 *
 * React Query key contract (TIER 4 LOCKED):
 *   invalidates ["admin", "subscriptions"] — must match useSubscriptionsQuery key in adminHooks.ts
 * Tier 4 锁定 — 不得更改 invalidateQueries key; 必须与 adminHooks.ts 中 useSubscriptionsQuery key 一致.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useAPI } from "@/api/context";
import type { SubscriptionPayload } from "@/api/types";

/**
 * useSubscriptionsMutations returns all CRUD mutations for subscriptions.
 * useSubscriptionsMutations 返回订阅所有 CRUD mutations.
 *
 * All mutations share the same `invalidate` callback that drops the subscriptions list cache.
 * 所有 mutations 共享同一 invalidate 回调以清除订阅列表缓存.
 */
export function useSubscriptionsMutations() {
  const api = useAPI();
  const queryClient = useQueryClient();

  // invalidate drops the subscriptions list from the cache so the panel re-fetches fresh data.
  // invalidate 清除订阅列表缓存, 让面板重新获取最新数据.
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "subscriptions"] });
  };

  // invalidateWithSources also drops the sources list, used after create/sync which import
  // sources from the subscription URL — without this the SourcesPanel keeps showing stale data.
  // invalidateWithSources 同时清除源列表缓存, 用于 create/sync 这类会从订阅 URL 导入源的操作 —
  // 否则 SourcesPanel 仍展示旧数据.
  const invalidateWithSources = () => {
    invalidate();
    void queryClient.invalidateQueries({ queryKey: ["admin", "sources"] });
  };

  return {
    /** create — creates a new subscription (server auto-syncs sources) and refreshes both lists. / 新建订阅 (服务端自动同步源) 并刷新订阅与源两个列表. */
    create: useMutation({
      mutationFn: (payload: SubscriptionPayload) => api.createSubscription(payload),
      onSuccess: invalidateWithSources,
    }),
    /** update — updates an existing subscription by id. / 通过 id 更新已有订阅. */
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: SubscriptionPayload }) => api.updateSubscription(id, payload),
      onSuccess: invalidate,
    }),
    /** remove — deletes a subscription by id. / 通过 id 删除订阅. */
    remove: useMutation({
      mutationFn: (id: number) => api.deleteSubscription(id),
      onSuccess: invalidate,
    }),
    /**
     * sync — triggers an immediate sync for a subscription by id.
     * sync — 通过 id 触发订阅的立即同步.
     */
    sync: useMutation({
      mutationFn: (id: number) => api.syncSubscription(id),
      onSuccess: invalidateWithSources,
    }),
  };
}
