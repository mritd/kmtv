/**
 * SyncContext tests cover identity scoping, launch sync, lifecycle flushes, and legacy cleanup.
 *
 * SyncContext 测试覆盖身份隔离, 启动同步, 生命周期补写和旧数据清理.
 */
import { QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { APIClient } from "@/api/client";
import { APIProvider } from "@/api/context";
import { createMemoryTokenStore } from "@/api/tokenStore";
import { AuthProvider } from "@/auth/AuthContext";
import { createTestAPI } from "@/test/testAPI";
import { seedSyncStore } from "@/test/syncFixtures";

import { SyncProvider, useSync, useSyncList } from "./SyncContext";
import type { SyncStore } from "./syncStore";
import type { SyncPullResponse } from "./types";
import { useWatchResume } from "./useWatchResume";

let readyStore: SyncStore | null = null;

function Probe() {
  const sync = useSync();
  const searches = useSyncList("search");
  readyStore = sync.status === "ready" ? sync.store : null;
  return (
    <>
      <span data-testid="status">{sync.status}</span>
      <span data-testid="scope">{sync.status === "ready" ? sync.store.scopeKey : ""}</span>
      <span data-testid="engine">{sync.status === "ready" && sync.engine ? "on" : "off"}</span>
      <span data-testid="searches">{searches.map((r) => r.payload.query).join(",")}</span>
    </>
  );
}

function GateProbe() {
  const { pending } = useWatchResume("Demo Show");
  return <span data-testid="gate">{pending ? "pending" : "ready"}</span>;
}

function renderProvider(api: APIClient, signedIn: boolean, options: { strict?: boolean; children?: ReactNode } = {}) {
  const tokenStore = createMemoryTokenStore(
    signedIn ? { accessToken: "T", expiresAt: "2099-01-01T00:00:00Z", user: { id: 5, username: "alice", role: "user" } } : null,
  );
  const tree = (
    <APIProvider value={api}>
      <AuthProvider api={api} tokenStore={tokenStore} queryClient={new QueryClient()}>
        <SyncProvider>
          <Probe />
          {options.children}
        </SyncProvider>
      </AuthProvider>
    </APIProvider>
  );
  return render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
}

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("SyncProvider", () => {
  it("opens the anonymous scope without an engine", async () => {
    seedSyncStore(0, "", (store) => store.upsert("search", { query: "local" }));
    const syncPull = vi.fn();
    renderProvider(createTestAPI({ me: async () => ({ id: 0, username: "anonymous", role: "user" }), syncPull }), false);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(screen.getByTestId("scope")).toHaveTextContent(":0");
    expect(screen.getByTestId("engine")).toHaveTextContent("off");
    expect(screen.getByTestId("searches")).toHaveTextContent("local");
    expect(syncPull).not.toHaveBeenCalled();
  });

  it("opens the signed-in scope and syncs on launch", async () => {
    const syncPull = vi.fn(createTestAPI().syncPull);
    renderProvider(createTestAPI({ syncPull }), true);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(screen.getByTestId("scope")).toHaveTextContent(":5");
    expect(screen.getByTestId("engine")).toHaveTextContent("on");
    await waitFor(() => expect(syncPull).toHaveBeenCalled());
  });

  it("keeps the player gate waiting for the launch sync under StrictMode's effect replay", async () => {
    // The replayed effects stop and restart the engine, so the launch cycle can pull more than once;
    // releasing answers every pull, including later ones.
    //
    // 重放的 effect 会停止并重新启动引擎, 启动同步可能拉取不止一次; 放行后所有拉取都会得到响应,
    // 包括之后的拉取.
    const empty: SyncPullResponse = {
      epoch: "e1", server_time_ms: Date.now(), rev: 0, reset: false, has_more: false, clears: [], records: [],
    };
    let released = false;
    const waiting: Array<() => void> = [];
    const releasePull = () => {
      released = true;
      for (const resolve of waiting.splice(0)) resolve();
    };
    const syncPull = vi.fn(() => new Promise<SyncPullResponse>((resolve) => {
      if (released) resolve(empty);
      else waiting.push(() => resolve(empty));
    }));
    renderProvider(createTestAPI({ syncPull }), true, { strict: true, children: <GateProbe /> });
    await waitFor(() => expect(syncPull).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.getByTestId("gate")).toHaveTextContent("pending");
    await act(async () => {
      releasePull();
    });
    await waitFor(() => expect(screen.getByTestId("gate")).toHaveTextContent("ready"));
  });

  it("flushes with keepalive when the page is hidden", async () => {
    const syncPush = vi.fn(createTestAPI().syncPush);
    const syncPull = vi.fn(() => new Promise<never>(() => undefined));
    renderProvider(createTestAPI({ syncPush, syncPull }), true);
    // The launch cycle is now parked in a pull that never resolves.
    //
    // 启动同步此时停在一个永不返回的拉取上.
    await waitFor(() => expect(syncPull).toHaveBeenCalled());
    act(() => {
      readyStore!.upsert("search", { query: "pending" });
    });
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(syncPush).toHaveBeenCalledTimes(1);
    expect(syncPush.mock.calls[0]![0].changes).toMatchObject([{ kind: "search", op: "upsert", payload: { query: "pending" } }]);
    expect(syncPush.mock.calls[0]![1]).toEqual({ keepalive: true });
    visibility.mockRestore();
  });

  it("reloads when another tab writes the active scope", async () => {
    renderProvider(createTestAPI(), true);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    seedSyncStore(5, "alice", (store) => store.upsert("search", { query: "other tab" }));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: readyStore!.scopeKey }));
    });
    expect(screen.getByTestId("searches")).toHaveTextContent("other tab");
  });

  it("deletes legacy storage keys", async () => {
    window.localStorage.setItem("kmtv.favorites", "[]");
    renderProvider(createTestAPI(), true);
    await waitFor(() => expect(window.localStorage.getItem("kmtv.favorites")).toBeNull());
  });
});
