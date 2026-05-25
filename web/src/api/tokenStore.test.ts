import { describe, expect, it, vi } from "vitest";

import { createLocalTokenStore, createMemoryTokenStore } from "./tokenStore";

describe("token stores", () => {
  it("keeps token snapshots in memory", () => {
    const store = createMemoryTokenStore();

    expect(store.get()).toBeNull();

    store.set({
      accessToken: "Token",
      expiresAt: "2026-05-23T12:00:00Z",
      user: { id: 1, username: "admin", role: "admin" },
    });

    expect(store.get()?.user.username).toBe("admin");

    store.clear();
    expect(store.get()).toBeNull();
  });

  it("ignores corrupt local storage payloads", () => {
    const storage = new Map<string, string>();
    storage.set("kmtv.auth", "{bad json");

    const store = createLocalTokenStore({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    });

    expect(store.get()).toBeNull();
    expect(storage.has("kmtv.auth")).toBe(false);
  });

  it("persists and clears local storage payloads", () => {
    const storage = new Map<string, string>();
    const store = createLocalTokenStore({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    });

    store.set({
      accessToken: "Token",
      expiresAt: "2026-05-23T12:00:00Z",
      user: { id: 1, username: "admin", role: "admin" },
    });

    expect(store.get()?.accessToken).toBe("Token");

    store.clear();
    expect(store.get()).toBeNull();
  });
});

// createMemoryStorage is an in-memory StorageLike for tests.
// createMemoryStorage
// 是测试用的内存版 StorageLike.
function createMemoryStorage(): import("./tokenStore").StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

describe("observable tokenStore", () => {
  it("subscribe fires on set and clear in the same tab", () => {
    const storage = createMemoryStorage();
    const store = createLocalTokenStore(storage, { observeWindowStorage: false, storageKey: "kmtv.auth.t1" });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.set({ accessToken: "a", expiresAt: "2099", user: { id: 1, username: "x", role: "user" } });
    expect(listener).toHaveBeenCalledTimes(1);

    store.clear("logout");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.get()).toBeNull();

    unsubscribe();
    store.set({ accessToken: "b", expiresAt: "2099", user: { id: 2, username: "y", role: "user" } });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("clear remembers the most recent reason", () => {
    const store = createMemoryTokenStore();
    store.set({ accessToken: "a", expiresAt: "2099", user: { id: 1, username: "x", role: "user" } });
    store.clear("unauthorized");
    expect(store.lastClearReason()).toBe("unauthorized");
  });

  it("cross-tab storage event from another tab is observed", () => {
    const storage = createMemoryStorage();
    storage.setItem("kmtv.auth.t3", JSON.stringify({ accessToken: "a", expiresAt: "2099", user: { id: 1, username: "x", role: "user" } }));
    const store = createLocalTokenStore(storage, { observeWindowStorage: true, storageKey: "kmtv.auth.t3" });
    const listener = vi.fn();
    store.subscribe(listener);

    storage.removeItem("kmtv.auth.t3");
    window.dispatchEvent(new StorageEvent("storage", {
      key: "kmtv.auth.t3",
      newValue: null,
      storageArea: window.localStorage,
    }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.lastClearReason()).toBe("external");
  });

  it("invalid JSON in storage clears the slot without throwing", () => {
    const storage = createMemoryStorage();
    storage.setItem("kmtv.auth.t4", "{not json");
    const store = createLocalTokenStore(storage, { observeWindowStorage: false, storageKey: "kmtv.auth.t4" });
    expect(store.get()).toBeNull();
  });
});
