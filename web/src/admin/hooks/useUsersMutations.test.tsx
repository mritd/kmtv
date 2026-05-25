/**
 * useUsersMutations tests — happy path and cache invalidation.
 * useUsersMutations 测试 — 正常路径和缓存失效.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { APIProvider } from "@/api/context";
import { createTestAPI } from "@/test/testAPI";

import { useUsersMutations } from "./useUsersMutations";

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

describe("useUsersMutations", () => {
  describe("create", () => {
    it("resolves with the created user on success", async () => {
      const api = createTestAPI({
        createUser: async (u) => ({
          id: 99,
          username: u.username,
          role: u.role,
          allow_adult_content: u.allow_adult_content ?? false,
        }),
      });
      const { Wrapper } = makeSpyWrapper(api);
      const { result } = renderHook(() => useUsersMutations(), { wrapper: Wrapper });
      result.current.create.mutate({ username: "alice", password: "secret", role: "user" });
      await waitFor(() => expect(result.current.create.isSuccess).toBe(true));
      expect(result.current.create.data?.username).toBe("alice");
    });

    it("invalidates ['admin', 'users'] cache on success", async () => {
      const { Wrapper, invalidate } = makeSpyWrapper();
      const { result } = renderHook(() => useUsersMutations(), { wrapper: Wrapper });
      result.current.create.mutate({ username: "bob", password: "pw", role: "user" });
      await waitFor(() => expect(result.current.create.isSuccess).toBe(true));
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "users"] });
    });
  });

  describe("update", () => {
    it("invalidates ['admin', 'users'] cache on success", async () => {
      const { Wrapper, invalidate } = makeSpyWrapper();
      const { result } = renderHook(() => useUsersMutations(), { wrapper: Wrapper });
      result.current.update.mutate({ id: 1, payload: { username: "alice", role: "admin" } });
      await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "users"] });
    });

    it("surfaces error state when updateUser rejects", async () => {
      const api = createTestAPI({ updateUser: async () => { throw new Error("forbidden"); } });
      const { Wrapper } = makeSpyWrapper(api);
      const { result } = renderHook(() => useUsersMutations(), { wrapper: Wrapper });
      result.current.update.mutate({ id: 1, payload: { username: "alice", role: "admin" } });
      await waitFor(() => expect(result.current.update.isError).toBe(true));
      expect(result.current.update.error).toBeInstanceOf(Error);
    });
  });

  describe("remove", () => {
    it("invalidates ['admin', 'users'] cache on success", async () => {
      const { Wrapper, invalidate } = makeSpyWrapper();
      const { result } = renderHook(() => useUsersMutations(), { wrapper: Wrapper });
      result.current.remove.mutate(1);
      await waitFor(() => expect(result.current.remove.isSuccess).toBe(true));
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "users"] });
    });
  });
});
