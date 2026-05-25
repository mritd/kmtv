/**
 * useSettingsMutation — React Query mutation hook for saving admin system settings.
 * useSettingsMutation — 保存管理员系统设置的 React Query mutation hook.
 *
 * Responsibilities / 职责:
 *   - Submit a flat key→value settings map to the API — 向 API 提交扁平 key→value 设置映射
 *   - Invalidate the ["admin", "settings"] cache on success — 成功后使 ["admin", "settings"] 缓存失效
 *   - Reset all cached playback URLs via detailStore on success, because settings may flip
 *     the playback mode (proxy ↔ direct) which invalidates previously resolved URLs.
 *     成功后通过 detailStore 重置所有缓存的播放 URL, 因为设置可能切换播放模式导致旧 URL 失效.
 *
 * Key exports / 主要导出:
 *   useSettingsMutation
 *
 * Callers / 调用方:
 *   admin/SystemSettingsPanel.tsx
 *
 * React Query key contract (TIER 4 LOCKED):
 *   invalidates ["admin", "settings"]
 * Tier 4 锁定 — 不得更改 invalidateQueries key.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useAPI } from "@/api/context";
import { detailStore } from "@/store/detailStore";

/**
 * useSettingsMutation returns a mutation that saves a settings key→value map.
 * useSettingsMutation 返回保存设置 key→value 映射的 mutation.
 *
 * On success it:
 *   1. Invalidates the admin settings cache so the panel re-fetches fresh values.
 *   2. Resets all playback state so the player re-resolves URLs under the new mode.
 * 成功后:
 *   1. 使管理员设置缓存失效, 面板重新获取最新值.
 *   2. 重置所有播放状态, 让播放器在新模式下重新解析 URL.
 */
export function useSettingsMutation() {
  const api = useAPI();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: Record<string, string>) => api.updateSettings(settings),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
      // Settings can flip playback proxy/direct mode; drop cached URLs so the next play re-resolves.
      // 设置可能切换播放模式; 清除缓存 URL 使下次播放重新解析.
      detailStore.getState().resetAllPlayback();
    },
  });
}
