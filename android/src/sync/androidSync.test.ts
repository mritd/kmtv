// androidSync tests — MMKV storage adapter, legacy cleanup, sync transport, and error classes.
//
// androidSync 测试 — MMKV 存储适配, 旧数据清理, 同步传输层和错误分类.

import { createMMKV } from "react-native-mmkv";

import type { APIClient } from "@/api/client";

import {
  LEGACY_SYNC_KEYS,
  checkSyncServer,
  classifySyncError,
  createSyncTransport,
  isSyncServerVersion,
  mmkvSyncStorage,
  removeLegacySyncKeys,
  SyncIdentityChangedError,
  syncServerKey,
} from "./androidSync";

describe("androidSync", () => {
  it("adapts MMKV to SyncStorage", () => {
    const mmkv = createMMKV({ id: "sync-adapter" });
    const storage = mmkvSyncStorage(mmkv);
    expect(storage.getItem("k")).toBeNull();
    storage.setItem("k", "v");
    expect(storage.getItem("k")).toBe("v");
  });

  it("removes legacy keys, including per-user watch history, and keeps the rest", () => {
    const mmkv = createMMKV({ id: "sync-legacy" });
    for (const key of LEGACY_SYNC_KEYS) mmkv.set(key, "[]");
    mmkv.set("kmtv:watchHistory:user:7", "[]");
    mmkv.set("kmtv:playbackSettings:T", "{}");
    removeLegacySyncKeys(mmkv);
    expect(mmkv.getAllKeys()).toEqual(["kmtv:playbackSettings:T"]);
  });

  it("builds push and pull requests", async () => {
    const get = jest.fn(async () => ({}));
    const post = jest.fn(async () => ({}));
    const transport = createSyncTransport({ get, post } as unknown as Pick<APIClient, "get" | "post">);
    await transport.push({ epoch: "e1", cursor: 4, changes: [] }, { keepalive: true });
    await transport.pull({ since: 4, epoch: "e1", limit: 500 });
    await transport.pull({ since: 0, epoch: "", limit: 20 });
    await transport.pull({ since: 3, epoch: "e1", limit: 20, full: true });
    await transport.pull({ since: 3, epoch: "e1", limit: 20, full: false });
    expect(post).toHaveBeenCalledWith("/sync/push", { epoch: "e1", cursor: 4, changes: [] });
    expect(get).toHaveBeenNthCalledWith(1, "/sync/pull?since=4&limit=500&epoch=e1");
    expect(get).toHaveBeenNthCalledWith(2, "/sync/pull?since=0&limit=20");
    expect(get).toHaveBeenNthCalledWith(3, "/sync/pull?since=3&limit=20&epoch=e1&full=1");
    expect(get).toHaveBeenNthCalledWith(4, "/sync/pull?since=3&limit=20&epoch=e1");
  });

  it("refuses to send once the signed-in user is no longer the scope's user", async () => {
    const get = jest.fn(async () => ({}));
    const post = jest.fn(async () => ({}));
    let current: number | null = 5;
    const transport = createSyncTransport({ get, post } as unknown as Pick<APIClient, "get" | "post">, {
      userID: 5,
      currentUserID: () => current,
    });
    await transport.pull({ since: 0, epoch: "", limit: 20 });
    current = 6;
    await expect(transport.push({ epoch: "e1", cursor: 0, changes: [] }, { keepalive: false })).rejects.toBeInstanceOf(SyncIdentityChangedError);
    await expect(transport.pull({ since: 0, epoch: "", limit: 20 })).rejects.toBeInstanceOf(SyncIdentityChangedError);
    current = null;
    await expect(transport.pull({ since: 0, epoch: "", limit: 20 })).rejects.toBeInstanceOf(SyncIdentityChangedError);
    expect(get).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });

  it("normalizes server URLs for the scope key", () => {
    expect(syncServerKey(" http://Media.Example:8080/ ")).toBe("http://media.example:8080");
    expect(syncServerKey("http://srv//")).toBe("http://srv");
  });

  it("accepts only servers with the sync endpoints", async () => {
    expect(isSyncServerVersion("v1.1.0")).toBe(true);
    expect(isSyncServerVersion("v1.2.3-rc1")).toBe(true);
    expect(isSyncServerVersion("v2.0.0")).toBe(true);
    expect(isSyncServerVersion("v0.0.0-dev")).toBe(true);
    expect(isSyncServerVersion("v1.0.6")).toBe(false);
    expect(isSyncServerVersion("garbage")).toBe(false);

    const client = (version?: string) => ({ get: jest.fn(async () => ({ settings: version === undefined ? {} : { version } })) });
    await expect(checkSyncServer("http://srv", client("v1.0.6") as never)).resolves.toBe(false);
    await expect(checkSyncServer("http://srv", client("v1.1.0") as never)).resolves.toBe(true);
    await expect(checkSyncServer("http://srv", client() as never)).resolves.toBe(true);
    const failing = { get: jest.fn(async () => Promise.reject(new Error("offline"))) };
    await expect(checkSyncServer("http://srv", failing as never)).resolves.toBe(true);
  });

  it("classifies API errors for the engine", () => {
    expect(classifySyncError({ kind: "unauthorized" })).toBe("unauthorized");
    expect(classifySyncError(new SyncIdentityChangedError())).toBe("unauthorized");
    expect(classifySyncError({ kind: "server", message: "sync epoch mismatch", status: 409 })).toBe("conflict");
    expect(classifySyncError({ kind: "server", message: "sync cursor ahead of server", status: 409 })).toBe("conflict");
    expect(classifySyncError({ kind: "server", message: "boom", status: 500 })).toBe("retry");
    expect(classifySyncError({ kind: "network" })).toBe("retry");
    expect(classifySyncError(new Error("x"))).toBe("retry");
    expect(classifySyncError(null)).toBe("retry");
  });
});
