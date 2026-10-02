/**
 * webSync tests cover legacy cleanup, the API transport, error classes, and the tab lock.
 *
 * webSync 测试覆盖旧数据清理, API 传输层, 错误分类和标签页锁.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { APIError } from "@/api/client";

import {
  LEGACY_SYNC_STORAGE_KEYS,
  SyncIdentityChangedError,
  classifyWebSyncError,
  createWebSyncTransport,
  removeLegacySyncStorage,
  webRunExclusive,
} from "./webSync";

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("webSync", () => {
  it("deletes the pre-sync localStorage keys only", () => {
    for (const key of LEGACY_SYNC_STORAGE_KEYS) window.localStorage.setItem(key, "[]");
    window.localStorage.setItem("kmtv.theme", "dark");
    removeLegacySyncStorage(window.localStorage);
    for (const key of LEGACY_SYNC_STORAGE_KEYS) expect(window.localStorage.getItem(key)).toBeNull();
    expect(window.localStorage.getItem("kmtv.theme")).toBe("dark");
  });

  it("forwards push and pull to the API client", async () => {
    const syncPush = vi.fn(async () => ({ epoch: "e", rev: 0, server_time_ms: 1, results: [] }));
    const syncPull = vi.fn(async () => ({ epoch: "e", server_time_ms: 1, rev: 0, reset: false, has_more: false, clears: [], records: [] }));
    const transport = createWebSyncTransport({ syncPush, syncPull }, { userID: 7, currentUserID: () => 7 });
    await transport.push({ epoch: "e", cursor: 3, changes: [] }, { keepalive: true });
    await transport.pull({ since: 3, epoch: "e", limit: 10 });
    await transport.pull({ since: 0, epoch: "", limit: 10, full: true });
    expect(syncPush).toHaveBeenCalledWith({ epoch: "e", cursor: 3, changes: [] }, { keepalive: true });
    expect(syncPull).toHaveBeenNthCalledWith(1, { since: 3, epoch: "e", limit: 10 });
    expect(syncPull).toHaveBeenNthCalledWith(2, { since: 0, epoch: "", limit: 10, full: true });
  });

  it("refuses to send once the live token belongs to another user or is gone", async () => {
    const syncPush = vi.fn();
    const syncPull = vi.fn();
    let liveUserID: number | null = 8;
    const transport = createWebSyncTransport({ syncPush, syncPull }, { userID: 7, currentUserID: () => liveUserID });

    const push = transport.push({ epoch: "e", cursor: 3, changes: [] }, { keepalive: false });
    await expect(push).rejects.toBeInstanceOf(SyncIdentityChangedError);
    liveUserID = null;
    const pull = transport.pull({ since: 3, epoch: "e", limit: 10 });
    await expect(pull).rejects.toBeInstanceOf(SyncIdentityChangedError);

    expect(syncPush).not.toHaveBeenCalled();
    expect(syncPull).not.toHaveBeenCalled();
    expect(classifyWebSyncError(new SyncIdentityChangedError())).toBe("unauthorized");
  });

  it("classifies API errors for the engine", () => {
    expect(classifyWebSyncError(new APIError(401, 1002, "not logged in"))).toBe("unauthorized");
    expect(classifyWebSyncError(new APIError(409, 1209, "sync epoch mismatch"))).toBe("conflict");
    expect(classifyWebSyncError(new APIError(409, 1210, "sync cursor ahead of server"))).toBe("conflict");
    expect(classifyWebSyncError(new APIError(500, 1000, "boom"))).toBe("retry");
    expect(classifyWebSyncError(new TypeError("Failed to fetch"))).toBe("retry");
  });

  it("runs tasks under a Web Lock when the browser has one", async () => {
    const request = vi.fn(async (_name: string, task: () => Promise<void>) => task());
    vi.stubGlobal("navigator", { ...navigator, locks: { request } });
    const task = vi.fn(async () => undefined);
    await webRunExclusive("scope")(task);
    expect(request).toHaveBeenCalledWith("scope", task);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("runs tasks directly without Web Locks", async () => {
    vi.stubGlobal("navigator", { ...navigator, locks: undefined });
    const task = vi.fn(async () => undefined);
    await webRunExclusive("scope")(task);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
