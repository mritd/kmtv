/**
 * useSourcesMutations tests — happy path and cache invalidation.
 * useSourcesMutations 测试 — 正常路径和缓存失效.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { APIProvider } from "@/api/context";
import type { Source } from "@/api/types";
import { createTestAPI } from "@/test/testAPI";

import { useSourcesMutations } from "./useSourcesMutations";

// makeWrapper creates a QueryClient + APIProvider wrapper for hook tests.
// makeWrapper 为 hook 测试创建 QueryClient + APIProvider 包装器.
function makeWrapper(api = createTestAPI()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <APIProvider value={api}>{children}</APIProvider>
      </QueryClientProvider>
    );
  };
}

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

const sampleSource: Source = {
  id: 1,
  key: "src-a",
  name: "Source A",
  api: "https://a.example",
  detail: "",
  enabled: true,
  searchable: true,
  is_adult: false,
  comment: "",
  health: "healthy",
  last_check: "",
  created_at: "",
  updated_at: "",
};

describe("useSourcesMutations", () => {
  describe("create", () => {
    it("resolves on successful creation", async () => {
      const { result } = renderHook(() => useSourcesMutations(), { wrapper: makeWrapper() });
      result.current.create.mutate({
        key: "src-b", name: "B", api: "https://b.example",
        detail: "", enabled: true, searchable: true, is_adult: false, comment: "",
      });
      await waitFor(() => expect(result.current.create.isSuccess).toBe(true));
    });

    it("invalidates ['admin', 'sources'] cache on success", async () => {
      const { Wrapper, invalidate } = makeSpyWrapper();
      const { result } = renderHook(() => useSourcesMutations(), { wrapper: Wrapper });
      result.current.create.mutate({
        key: "src-c", name: "C", api: "https://c.example",
        detail: "", enabled: true, searchable: true, is_adult: false, comment: "",
      });
      await waitFor(() => expect(result.current.create.isSuccess).toBe(true));
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "sources"] });
    });
  });

  describe("update", () => {
    it("resolves on successful update", async () => {
      const { result } = renderHook(() => useSourcesMutations(), { wrapper: makeWrapper() });
      result.current.update.mutate({
        id: 1,
        payload: { key: "src-a", name: "A Updated", api: "https://a.example", detail: "", enabled: true, searchable: true, is_adult: false, comment: "" },
      });
      await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    });

    it("invalidates ['admin', 'sources'] cache on success", async () => {
      const { Wrapper, invalidate } = makeSpyWrapper();
      const { result } = renderHook(() => useSourcesMutations(), { wrapper: Wrapper });
      result.current.update.mutate({
        id: 1,
        payload: { key: "src-a", name: "A Updated", api: "https://a.example", detail: "", enabled: true, searchable: true, is_adult: false, comment: "" },
      });
      await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "sources"] });
    });
  });

  describe("remove", () => {
    it("invalidates ['admin', 'sources'] cache on success", async () => {
      const { Wrapper, invalidate } = makeSpyWrapper();
      const { result } = renderHook(() => useSourcesMutations(), { wrapper: Wrapper });
      result.current.remove.mutate(1);
      await waitFor(() => expect(result.current.remove.isSuccess).toBe(true));
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "sources"] });
    });
  });

  describe("toggleEnabled", () => {
    it("inverts the enabled field and invalidates cache", async () => {
      let capturedEnabled: boolean | undefined;
      const api = createTestAPI({
        updateSource: async (_id, payload) => { capturedEnabled = payload.enabled; },
      });
      const { Wrapper, invalidate } = makeSpyWrapper(api);
      const { result } = renderHook(() => useSourcesMutations(), { wrapper: Wrapper });
      result.current.toggleEnabled.mutate(sampleSource); // enabled: true → should become false
      await waitFor(() => expect(result.current.toggleEnabled.isSuccess).toBe(true));
      expect(capturedEnabled).toBe(false);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "sources"] });
    });
  });

  describe("importBundle", () => {
    it("resolves with imported count and invalidates cache", async () => {
      const api = createTestAPI({ importSources: async () => ({ imported: 3 }) });
      const { Wrapper, invalidate } = makeSpyWrapper(api);
      const { result } = renderHook(() => useSourcesMutations(), { wrapper: Wrapper });
      result.current.importBundle.mutate({ sources: [] });
      await waitFor(() => expect(result.current.importBundle.isSuccess).toBe(true));
      expect(result.current.importBundle.data?.imported).toBe(3);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "sources"] });
    });
  });
});
