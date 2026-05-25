/**
 * useSubscriptionsMutations tests — happy path and cache invalidation.
 * useSubscriptionsMutations 测试 — 正常路径和缓存失效.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { APIProvider } from "@/api/context";
import { createTestAPI } from "@/test/testAPI";

import { useSubscriptionsMutations } from "./useSubscriptionsMutations";

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

const PAYLOAD = { url: "https://sub.example", auto_update: true, interval: 3600 };

describe("useSubscriptionsMutations", () => {
  describe("create", () => {
    it("resolves on successful creation", async () => {
      const { Wrapper } = makeSpyWrapper();
      const { result } = renderHook(() => useSubscriptionsMutations(), { wrapper: Wrapper });
      result.current.create.mutate(PAYLOAD);
      await waitFor(() => expect(result.current.create.isSuccess).toBe(true));
    });

    it("invalidates both subscriptions and sources caches on success", async () => {
      const { Wrapper, invalidate } = makeSpyWrapper();
      const { result } = renderHook(() => useSubscriptionsMutations(), { wrapper: Wrapper });
      result.current.create.mutate(PAYLOAD);
      await waitFor(() => expect(result.current.create.isSuccess).toBe(true));
      // Create auto-syncs sources server-side, so the sources list must refresh too.
      // 创建会在服务端自动同步源, 因此源列表也必须刷新.
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "subscriptions"] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "sources"] });
    });
  });

  describe("update", () => {
    it("invalidates ['admin', 'subscriptions'] cache on success", async () => {
      const { Wrapper, invalidate } = makeSpyWrapper();
      const { result } = renderHook(() => useSubscriptionsMutations(), { wrapper: Wrapper });
      result.current.update.mutate({ id: 1, payload: PAYLOAD });
      await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "subscriptions"] });
    });
  });

  describe("remove", () => {
    it("invalidates ['admin', 'subscriptions'] cache on success", async () => {
      const { Wrapper, invalidate } = makeSpyWrapper();
      const { result } = renderHook(() => useSubscriptionsMutations(), { wrapper: Wrapper });
      result.current.remove.mutate(1);
      await waitFor(() => expect(result.current.remove.isSuccess).toBe(true));
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "subscriptions"] });
    });
  });

  describe("sync", () => {
    it("resolves and invalidates both subscriptions and sources caches on success", async () => {
      const { Wrapper, invalidate } = makeSpyWrapper();
      const { result } = renderHook(() => useSubscriptionsMutations(), { wrapper: Wrapper });
      result.current.sync.mutate(1);
      await waitFor(() => expect(result.current.sync.isSuccess).toBe(true));
      // Sync imports sources from the subscription URL, so the sources list must refresh too.
      // 同步会从订阅 URL 导入源, 因此源列表也必须刷新.
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "subscriptions"] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "sources"] });
    });
  });
});
