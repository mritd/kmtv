/**
 * useSettingsMutation tests — happy path, cache invalidation, and playback reset.
 * useSettingsMutation 测试 — 正常路径、缓存失效和播放状态重置.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { APIProvider } from "@/api/context";
import { createTestAPI } from "@/test/testAPI";

import { useSettingsMutation } from "./useSettingsMutation";

// makeSpyWrapper creates a wrapper with a spy on invalidateQueries.
// makeSpyWrapper 创建带 invalidateQueries spy 的包装器.
function makeSpyWrapper(api = createTestAPI()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.fn().mockResolvedValue(undefined);
  queryClient.invalidateQueries = invalidate;
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <APIProvider value={api}>{children}</APIProvider>
    </QueryClientProvider>
  );
  return { Wrapper, invalidate };
}

describe("useSettingsMutation", () => {
  describe("when update succeeds", () => {
    it("resolves on successful settings update", async () => {
      const { Wrapper } = makeSpyWrapper();
      const { result } = renderHook(() => useSettingsMutation(), { wrapper: Wrapper });
      result.current.mutate({ site_name: "KMTV Test" });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it("invalidates ['admin', 'settings'] cache on success", async () => {
      const { Wrapper, invalidate } = makeSpyWrapper();
      const { result } = renderHook(() => useSettingsMutation(), { wrapper: Wrapper });
      result.current.mutate({ playback_mode: "direct" });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "settings"] });
    });

    it("calls detailStore.resetAllPlayback() on success to flush cached playback URLs", async () => {
      // Import detailStore here to spy on the method the mutation is contractually required to call.
      // 导入 detailStore 以监视 mutation 契约要求调用的方法.
      const { detailStore } = await import("@/store/detailStore");
      const spy = vi.spyOn(detailStore.getState(), "resetAllPlayback");

      const { Wrapper } = makeSpyWrapper();
      const { result } = renderHook(() => useSettingsMutation(), { wrapper: Wrapper });
      result.current.mutate({ playback_mode: "proxy" });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(spy).toHaveBeenCalledOnce();

      spy.mockRestore();
    });
  });

  describe("when update fails", () => {
    it("surfaces error state when updateSettings rejects", async () => {
      const api = createTestAPI({ updateSettings: async () => { throw new Error("forbidden"); } });
      const { Wrapper } = makeSpyWrapper(api);
      const { result } = renderHook(() => useSettingsMutation(), { wrapper: Wrapper });
      result.current.mutate({ site_name: "x" });
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeInstanceOf(Error);
    });
  });
});
