/**
 * syncStore tests cover persistence, identity scoping, local writes, caps, and reloads.
 *
 * syncStore 测试覆盖持久化, 身份隔离, 本地写入, 上限和重新加载.
 */
import { describe, expect, it, vi } from "vitest";

import { createSyncClock } from "./syncClock";
import { createSyncStore, syncScopeKey, type SyncStorage } from "./syncStore";

const scopeKey = syncScopeKey("http://localhost:3000", 7);

function memoryStorage(): SyncStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function makeStore(storage: SyncStorage, username = "alice", now = () => 1_000) {
  return createSyncStore({ storage, scopeKey, username, clock: createSyncClock(0, now) });
}

const emptyFavorite = { cover: "", type: "", year: "", rate: "", desc: "", source_key: "", video_id: "" };
const emptyWatch = { cover: "", source_key: "", video_id: "", episode: "", group_index: 0, episode_index: 0, progress_sec: 1, duration_sec: 2, completed: false };

describe("syncScopeKey", () => {
  it("scopes by origin and user, mapping negative IDs to anonymous", () => {
    expect(syncScopeKey("https://a.example", 3)).toBe("kmtv.sync.v1:https://a.example:3");
    expect(syncScopeKey("https://a.example", -1)).toBe("kmtv.sync.v1:https://a.example:0");
  });
});

describe("createSyncStore", () => {
  it("persists local writes under the scope key and reloads them", () => {
    const storage = memoryStorage();
    const saved = makeStore(storage).upsert("favorite", { ...emptyFavorite, title: "  Show X " });
    expect(saved).toMatchObject({ key: "show x", dirty: true, synced: false, eventTimeMs: 1_000 });
    expect(saved?.payload.title).toBe("Show X");
    expect(storage.data.get(scopeKey)).toContain("show x");
    expect(makeStore(storage).get("favorite", "SHOW X")?.payload.title).toBe("Show X");
  });

  it("returns null for a blank key and keeps the synced flag on later edits", () => {
    const store = makeStore(memoryStorage());
    expect(store.upsert("search", { query: "   " })).toBeNull();
    store.update((state) => ({
      ...state,
      records: { "search|a": { kind: "search", key: "a", payload: { query: "a" }, eventTimeMs: 1, deleted: false, dirty: false, synced: true } },
    }));
    expect(store.upsert("search", { query: "A" })).toMatchObject({ synced: true, dirty: true });
  });

  it("writes tombstones on remove and hides them from reads", () => {
    const store = makeStore(memoryStorage());
    store.upsert("search", { query: "Alpha" });
    store.remove("search", " ALPHA ");
    expect(store.get("search", "alpha")).toBeNull();
    expect(store.list("search")).toEqual([]);
    expect(store.state().records["search|alpha"]).toMatchObject({ deleted: true, dirty: true });
  });

  it("clears older records of one kind and records a pending clear", () => {
    let now = 1_000;
    const store = makeStore(memoryStorage(), "alice", () => now);
    store.upsert("search", { query: "a" });
    store.upsert("favorite", { ...emptyFavorite, title: "f" });
    now = 2_000;
    store.clear("search");
    expect(store.list("search")).toEqual([]);
    expect(store.list("favorite")).toHaveLength(1);
    expect(store.state().pendingClears.search).toBe(2_000);
  });

  it("notifies subscribers and local-change listeners", () => {
    const store = makeStore(memoryStorage());
    const listener = vi.fn();
    const local = vi.fn();
    store.subscribe(listener);
    store.onLocalChange(local);
    store.upsert("search", { query: "a" });
    store.update((state) => state);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(local).toHaveBeenCalledTimes(1);
    expect(local).toHaveBeenCalledWith("search");
  });

  it("keeps state saved under an older username until the epoch changes", () => {
    const storage = memoryStorage();
    makeStore(storage, "alice").upsert("search", { query: "kept" });
    const renamed = makeStore(storage, "alice2");
    expect(renamed.username).toBe("alice2");
    expect(renamed.state().username).toBe("alice");
    expect(renamed.list("search")).toHaveLength(1);
  });

  it("gives each record an event time later than its previous one, even with a frozen clock", () => {
    const store = makeStore(memoryStorage());
    expect(store.upsert("search", { query: "a" })?.eventTimeMs).toBe(1_000);
    expect(store.upsert("search", { query: "a" })?.eventTimeMs).toBe(1_001);
    expect(store.upsert("search", { query: "b" })?.eventTimeMs).toBe(1_000);
    store.remove("search", "a");
    expect(store.state().records["search|a"]?.eventTimeMs).toBe(1_002);
    store.clear("search");
    expect(store.state().pendingClears.search).toBe(1_003);
    expect(store.upsert("search", { query: "c" })?.eventTimeMs).toBe(1_004);
  });

  it("keeps writes in memory after storage stops accepting them", () => {
    const storage = memoryStorage();
    const full: SyncStorage = {
      getItem: (key) => storage.getItem(key),
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = makeStore(full);
    store.upsert("search", { query: "one" });
    store.upsert("search", { query: "two" });
    expect(store.list("search").map((r) => r.key).sort()).toEqual(["one", "two"]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("treats corrupt or unreadable storage as empty", () => {
    const storage = memoryStorage();
    storage.setItem(scopeKey, "{not json");
    expect(makeStore(storage).state().records).toEqual({});
    storage.setItem(scopeKey, JSON.stringify({ version: 2, records: {} }));
    expect(makeStore(storage).state().records).toEqual({});
    const broken: SyncStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = makeStore(broken);
    expect(store.upsert("search", { query: "kept in memory" })).not.toBeNull();
    expect(store.get("search", "kept in memory")).not.toBeNull();
    warn.mockRestore();
  });

  it("drops malformed stored records and keeps the rest", () => {
    const storage = memoryStorage();
    storage.setItem(
      scopeKey,
      JSON.stringify({
        version: 1,
        username: "alice",
        epoch: "e1",
        cursor: 3,
        clockOffsetMs: 0,
        records: {
          "search|ok": { kind: "search", key: "ok", payload: { query: "ok" }, eventTimeMs: 5, deleted: false, dirty: true, synced: false },
          "search|bad time": { kind: "search", key: "bad time", payload: { query: "bad time" }, eventTimeMs: "5" },
          "bogus|x": { kind: "bogus", key: "x", payload: {}, eventTimeMs: 5 },
          "search|other": { kind: "search", key: "mismatch", payload: { query: "mismatch" }, eventTimeMs: 5 },
          "favorite|no payload": { kind: "favorite", key: "no payload", eventTimeMs: 5 },
        },
        pendingClears: { search: 4, bogus: 9, watch: -1 },
      }),
    );
    const store = makeStore(storage);
    expect(Object.keys(store.state().records)).toEqual(["search|ok"]);
    expect(store.state().records["search|ok"]).toMatchObject({ dirty: true, synced: false, deleted: false });
    expect(store.state().pendingClears).toEqual({ search: 4 });
    expect(store.state().cursor).toBe(3);
  });

  it("re-reads storage before every write so another instance's write is kept", () => {
    const storage = memoryStorage();
    const tabA = makeStore(storage);
    const tabB = makeStore(storage);
    tabA.upsert("search", { query: "from a" });
    tabB.upsert("search", { query: "from b" });
    expect(makeStore(storage).list("search").map((r) => r.key).sort()).toEqual(["from a", "from b"]);
  });

  it("reloads state written by another instance and notifies", () => {
    const storage = memoryStorage();
    const store = makeStore(storage);
    const listener = vi.fn();
    store.subscribe(listener);
    makeStore(storage).upsert("search", { query: "elsewhere" });
    expect(store.get("search", "elsewhere")).toBeNull();
    store.reload();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get("search", "elsewhere")).not.toBeNull();
  });

  it("trims watch records beyond 200", () => {
    let now = 0;
    const store = makeStore(memoryStorage(), "alice", () => ++now);
    for (let i = 0; i < 201; i += 1) store.upsert("watch", { ...emptyWatch, title: `t${i}` });
    expect(store.list("watch")).toHaveLength(200);
    expect(store.get("watch", "t0")).toBeNull();
  });
});
