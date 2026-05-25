/**
 * useSourcesMutations — React Query mutation hooks for all source CRUD operations.
 * useSourcesMutations — 所有视频源 CRUD 操作的 React Query mutation hooks.
 *
 * Responsibilities / 职责:
 *   - Provide create, update, remove, toggleEnabled, bulkSetEnabled, importBundle, checkAll mutations
 *     提供 create/update/remove/toggleEnabled/bulkSetEnabled/importBundle/checkAll mutations
 *   - Invalidate the ["admin", "sources"] cache after every successful mutation
 *     每次成功 mutation 后使 ["admin", "sources"] 缓存失效
 *
 * Key exports / 主要导出:
 *   useSourcesMutations
 *
 * Callers / 调用方:
 *   admin/forms/SourceForm.tsx
 *   admin/forms/SourceImportForm.tsx
 *   admin/SourcesPanel.tsx
 *
 * React Query key contract (TIER 4 LOCKED):
 *   invalidates ["admin", "sources"] — must match useSourcesQuery key in adminHooks.ts
 * Tier 4 锁定 — 不得更改 invalidateQueries key; 必须与 adminHooks.ts 中 useSourcesQuery key 一致.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useAPI } from "@/api/context";
import type { Source, SourcePayload } from "@/api/types";

/**
 * useSourcesMutations returns all CRUD and bulk-operation mutations for sources.
 * useSourcesMutations 返回视频源所有 CRUD 及批量操作 mutations.
 *
 * All mutations share the same `invalidate` callback that drops the sources list cache.
 * 所有 mutations 共享同一 invalidate 回调以清除源列表缓存.
 *
 * `toggleEnabled` derives the next payload from the current Source so the caller does not
 * need to compute the inverted enabled flag — just pass the full Source object.
 * toggleEnabled 从当前 Source 计算下一个 payload, 调用方只需传入完整 Source 对象.
 */
export function useSourcesMutations() {
  const api = useAPI();
  const queryClient = useQueryClient();

  // invalidate drops the sources list from the cache so the panel re-fetches fresh data.
  // invalidate 清除源列表缓存, 让面板重新获取最新数据.
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "sources"] });
  };

  return {
    /** create — creates a new source and invalidates the sources list. / 新建视频源并使源列表缓存失效. */
    create: useMutation({
      mutationFn: (payload: SourcePayload) => api.createSource(payload),
      onSuccess: invalidate,
    }),
    /** update — updates an existing source by id. / 通过 id 更新已有视频源. */
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: SourcePayload }) => api.updateSource(id, payload),
      onSuccess: invalidate,
    }),
    /** remove — deletes a source by id. / 通过 id 删除视频源. */
    remove: useMutation({
      mutationFn: (id: number) => api.deleteSource(id),
      onSuccess: invalidate,
    }),
    /**
     * toggleEnabled — flips the enabled state of a source.
     * toggleEnabled — 翻转视频源的 enabled 状态.
     *
     * The full Source object is accepted so the caller does not need to derive the payload.
     * 接受完整 Source 对象, 调用方无需自行计算 payload.
     */
    toggleEnabled: useMutation({
      mutationFn: async (source: Source) =>
        api.updateSource(source.id, { ...payloadFromSource(source), enabled: !source.enabled }),
      onSuccess: invalidate,
    }),
    /** bulkSetEnabled — enables or disables multiple sources by id array. / 批量启用或禁用多个视频源. */
    bulkSetEnabled: useMutation({
      mutationFn: ({ ids, enabled }: { ids: number[]; enabled: boolean }) =>
        api.bulkSetSourcesEnabled(ids, enabled),
      onSuccess: invalidate,
    }),
    /** importBundle — imports a JSON bundle payload from the SourceImportForm. / 从 SourceImportForm 导入 JSON bundle. */
    importBundle: useMutation({
      mutationFn: (data: Record<string, unknown>) => api.importSources(data),
      onSuccess: invalidate,
    }),
    /** checkAll — triggers health-check probes for all sources. / 触发所有视频源的健康检查探测. */
    checkAll: useMutation({
      mutationFn: () => api.checkAllSources(),
      onSuccess: invalidate,
    }),
  };
}

// payloadFromSource strips server-only fields from a Source to produce a SourcePayload.
// payloadFromSource 从 Source 中去除服务端字段, 生成 SourcePayload.
function payloadFromSource(source: Source): SourcePayload {
  const { id: _id, health: _h, last_check: _lc, created_at: _ca, updated_at: _ua, ...rest } = source;
  return rest;
}
