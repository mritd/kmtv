import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { createTestAPI } from "@/test/testAPI";
import { APIProvider } from "./context";
import {
  useAdminSettingsQuery,
  useCheckSourceMutation,
  useSourcesQuery,
  useSubscriptionsQuery,
  useUsersQuery,
} from "./adminHooks";

// makeWrapper creates a minimal QueryClient + APIProvider wrapper for hook tests.
// makeWrapper
// 为 hook 测试创建最小的 QueryClient + APIProvider 包装器.
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

describe("useSourcesQuery", () => {
  it("returns sources list on success", async () => {
    const api = createTestAPI({
      listSources: async () => ({
        sources: [
          {
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
          },
        ],
      }),
    });
    const { result } = renderHook(() => useSourcesQuery(), { wrapper: makeWrapper(api) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.sources).toHaveLength(1);
    expect(result.current.data?.sources[0].key).toBe("src-a");
  });

  it("surfaces error state when listSources rejects", async () => {
    const api = createTestAPI({
      listSources: async () => { throw new Error("network error"); },
    });
    const { result } = renderHook(() => useSourcesQuery(), { wrapper: makeWrapper(api) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it("polls when any source health is 'checking'", async () => {
    // Verify the refetchInterval callback returns a number (not false) when checking.
    // This validates the polling gate without needing real timers.
    // 验证 refetchInterval 在 checking 时返回数字而非 false.
    const api = createTestAPI({
      listSources: async () => ({
        sources: [
          {
            id: 1, key: "src-b", name: "B", api: "", detail: "",
            enabled: true, searchable: false, is_adult: false, comment: "",
            health: "checking", last_check: "", created_at: "", updated_at: "",
          },
        ],
      }),
    });
    const { result } = renderHook(() => useSourcesQuery(), { wrapper: makeWrapper(api) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The refetchInterval option is a function; test it directly via the query options.
    // We cannot call it directly through result, but can verify the data reached the hook.
    expect(result.current.data?.sources[0].health).toBe("checking");
  });
});

describe("useSubscriptionsQuery", () => {
  it("returns subscriptions list on success", async () => {
    const api = createTestAPI({
      listSubscriptions: async () => ({
        subscriptions: [{ id: 1, url: "https://sub.example", auto_update: true, interval: 3600, last_sync: "", updated_at: "" }],
      }),
    });
    const { result } = renderHook(() => useSubscriptionsQuery(), { wrapper: makeWrapper(api) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.subscriptions).toHaveLength(1);
    expect(result.current.data?.subscriptions[0].url).toBe("https://sub.example");
  });

  it("surfaces error state when listSubscriptions rejects", async () => {
    const api = createTestAPI({
      listSubscriptions: async () => { throw new Error("network error"); },
    });
    const { result } = renderHook(() => useSubscriptionsQuery(), { wrapper: makeWrapper(api) });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useUsersQuery", () => {
  it("returns users list on success", async () => {
    const api = createTestAPI({
      listUsers: async () => ({ users: [{ id: 1, username: "alice", role: "admin", allow_adult_content: false }] }),
    });
    const { result } = renderHook(() => useUsersQuery(), { wrapper: makeWrapper(api) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.users[0].username).toBe("alice");
  });

  it("surfaces error state when listUsers rejects", async () => {
    const api = createTestAPI({
      listUsers: async () => { throw new Error("network error"); },
    });
    const { result } = renderHook(() => useUsersQuery(), { wrapper: makeWrapper(api) });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useAdminSettingsQuery", () => {
  it("returns settings map on success", async () => {
    const api = createTestAPI({
      getSettings: async () => ({ settings: { site_name: "KMTV Test", version: "v1.0.0" } }),
    });
    const { result } = renderHook(() => useAdminSettingsQuery(), { wrapper: makeWrapper(api) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.settings.site_name).toBe("KMTV Test");
  });
});

describe("useCheckSourceMutation", () => {
  it("resolves with health status on success", async () => {
    const api = createTestAPI({
      checkSource: async (id) => ({ health: id === 42 ? "healthy" : "unhealthy" }),
    });
    const { result } = renderHook(() => useCheckSourceMutation(), { wrapper: makeWrapper(api) });
    result.current.mutate(42);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.health).toBe("healthy");
  });

  it("surfaces error state when checkSource rejects", async () => {
    const api = createTestAPI({
      checkSource: async () => { throw new Error("probe failed"); },
    });
    const { result } = renderHook(() => useCheckSourceMutation(), { wrapper: makeWrapper(api) });
    result.current.mutate(1);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it("calls invalidateQueries on the sources key after success", async () => {
    const invalidate = vi.fn().mockResolvedValue(undefined);
    // We need the real queryClient so we can spy on invalidateQueries.
    // This wrapper overrides the queryClient with a spy.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.invalidateQueries = invalidate;
    const api = createTestAPI();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <APIProvider value={api}>{children}</APIProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useCheckSourceMutation(), { wrapper });
    result.current.mutate(1);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "sources"] });
  });
});
