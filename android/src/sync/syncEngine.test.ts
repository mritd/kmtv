/**
 * syncEngine tests drive push-then-pull cycles against a scripted transport.
 *
 * syncEngine 测试使用脚本化传输层驱动 "先推送再拉取" 的同步流程.
 */

import { createSyncClock } from "./syncClock";
import {
  SYNC_CHANGE_DEBOUNCE_MS,
  SYNC_KEEPALIVE_MAX_BYTES,
  SYNC_RETRY_MAX_MS,
  createSyncEngine,
  type SyncErrorKind,
} from "./syncEngine";
import { createSyncStore, syncScopeKey, type SyncStorage } from "./syncStore";
import type { SyncPullResponse, SyncPushRequest, SyncPushResponse } from "./types";

class FakeSyncError extends Error {
  constructor(readonly kind: SyncErrorKind) {
    super(kind);
  }
}

function classifyError(error: unknown): SyncErrorKind {
  return error instanceof FakeSyncError ? error.kind : "retry";
}

function pullPage(overrides: Partial<SyncPullResponse> = {}): SyncPullResponse {
  return { epoch: "e1", server_time_ms: Date.now(), rev: 0, reset: false, has_more: false, clears: [], records: [], ...overrides };
}

function applied(body: SyncPushRequest): SyncPushResponse {
  return {
    epoch: body.epoch || "e1",
    rev: body.changes.length,
    server_time_ms: Date.now(),
    results: body.changes.map((_change, index) => ({ index, status: "applied" as const, record: null })),
  };
}

function memoryStorage(): SyncStorage {
  const data = new Map<string, string>();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

const watch = { title: "Movie", cover: "", source_key: "", video_id: "", episode: "", group_index: 0, episode_index: 0, progress_sec: 5, duration_sec: 100, completed: false };
const favorite = { cover: "", type: "", year: "", rate: "", desc: "", source_key: "", video_id: "" };

function setup(pulls: Array<SyncPullResponse | Error> = [], username = "alice", { start = true } = {}) {
  const store = createSyncStore({
    storage: memoryStorage(),
    scopeKey: syncScopeKey("http://localhost:3000", 1),
    username,
    clock: createSyncClock(0, () => Date.now()),
  });
  const pushes: Array<{ body: SyncPushRequest; keepalive: boolean }> = [];
  const push = jest.fn(async (body: SyncPushRequest, options: { keepalive: boolean }): Promise<SyncPushResponse> => {
    pushes.push({ body, keepalive: options.keepalive });
    return applied(body);
  });
  const queue = [...pulls];
  const pull = jest.fn(async (): Promise<SyncPullResponse> => {
    const next = queue.shift() ?? pullPage();
    if (next instanceof Error) throw next;
    return next;
  });
  const onLimit = jest.fn();
  const onUnauthorized = jest.fn();
  const engine = createSyncEngine({ transport: { push, pull }, classifyError, store, onLimit, onUnauthorized });
  if (start) engine.start();
  return { store, engine, push, pull, pushes, onLimit, onUnauthorized };
}

beforeEach(() => {
  jest.useFakeTimers({ now: 1_790_000_000_000 });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("createSyncEngine", () => {
  it("pushes dirty records, then pulls and applies remote records", async () => {
    const { store, engine, pushes } = setup([
      pullPage({
        rev: 3,
        records: [{ kind: "favorite", key: "show x", payload: { title: "Show X" }, event_time_ms: 5, deleted: false, rev: 3 }],
      }),
    ]);
    store.upsert("search", { query: "Alpha" });

    await engine.requestSync("launch");

    expect(pushes[0]!.body).toMatchObject({ epoch: "", cursor: 0 });
    expect(pushes[0]!.body.changes).toMatchObject([{ kind: "search", op: "upsert", payload: { query: "Alpha" } }]);
    expect(store.state().records["search|alpha"]).toMatchObject({ dirty: false, synced: true });
    expect(store.get("favorite", "Show X")?.payload.title).toBe("Show X");
    expect(store.state()).toMatchObject({ epoch: "e1", cursor: 3 });
    engine.stop();
  });

  it("re-uploads local data after the server epoch changes", async () => {
    const { store, engine, pushes } = setup([pullPage({ epoch: "e2", reset: true }), pullPage({ epoch: "e2", rev: 1 })]);
    store.upsert("favorite", { ...favorite, title: "Kept" });
    store.update((state) => ({
      ...state,
      epoch: "e1",
      cursor: 9,
      records: Object.fromEntries(Object.entries(state.records).map(([id, r]) => [id, { ...r, dirty: false, synced: true }])),
    }));

    await engine.requestSync("launch");

    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.body.epoch).toBe("e2");
    expect(pushes[0]!.body.changes[0]).toMatchObject({ kind: "favorite", op: "upsert" });
    expect(store.state()).toMatchObject({ epoch: "e2", cursor: 1 });
    engine.stop();
  });

  it("treats a push conflict as a reset discovered through pull", async () => {
    const { store, engine, push, pushes } = setup([pullPage({ epoch: "e2", reset: true }), pullPage({ epoch: "e2", rev: 1 })]);
    store.upsert("search", { query: "q" });
    store.update((state) => ({ ...state, epoch: "e1", cursor: 4 }));
    push.mockRejectedValueOnce(new FakeSyncError("conflict"));

    await engine.requestSync("launch");

    expect(push).toHaveBeenCalledTimes(2);
    expect(push.mock.calls[0]![0]).toMatchObject({ epoch: "e1", cursor: 4 });
    expect(pushes[0]!.body).toMatchObject({ epoch: "e2", cursor: 0 });
    expect(store.state().records["search|q"]).toMatchObject({ dirty: false, synced: true });
    engine.stop();
  });

  it("drops local data on a new epoch when it was written under another username", async () => {
    const { store, engine, push } = setup([pullPage({ epoch: "e2", reset: true }), pullPage({ epoch: "e2", rev: 1 })], "bob");
    store.upsert("search", { query: "someone else" });
    store.update((state) => ({ ...state, username: "alice", epoch: "e1", cursor: 4 }));

    await engine.requestSync("launch");

    expect(push).toHaveBeenCalledTimes(1);
    expect(store.list("search")).toEqual([]);
    expect(store.state()).toMatchObject({ username: "bob", epoch: "e2" });
    engine.stop();
  });

  it("records the current username after a pull with the same epoch", async () => {
    const { store, engine } = setup([pullPage({ rev: 2 })], "alice2");
    store.update((state) => ({ ...state, username: "alice", epoch: "e1", cursor: 1 }));
    await engine.requestSync("launch");
    expect(store.state()).toMatchObject({ username: "alice2", cursor: 2 });
    engine.stop();
  });

  it("re-uploads local data when a same-epoch reset reports a rev below the cursor", async () => {
    const { store, engine, push } = setup([pullPage({ reset: true, rev: 3 }), pullPage({ rev: 5 })]);
    store.upsert("favorite", { ...favorite, title: "Kept" });
    store.update((state) => ({
      ...state,
      epoch: "e1",
      cursor: 9,
      records: Object.fromEntries(Object.entries(state.records).map(([id, r]) => [id, { ...r, dirty: false, synced: true }])),
    }));
    store.upsert("search", { query: "new" });
    push.mockRejectedValueOnce(new FakeSyncError("conflict"));

    await engine.requestSync("launch");

    expect(push).toHaveBeenCalledTimes(2);
    expect(push.mock.calls[0]![0]).toMatchObject({ epoch: "e1", cursor: 9 });
    expect(push.mock.calls[1]![0]).toMatchObject({ epoch: "e1", cursor: 0 });
    expect(push.mock.calls[1]![0].changes.map((change) => change.kind).sort()).toEqual(["favorite", "search"]);
    expect(store.get("favorite", "Kept")).toMatchObject({ dirty: false, synced: true });
    expect(store.state()).toMatchObject({ epoch: "e1", cursor: 5 });
    engine.stop();
  });

  it("removes unseen synced records after a full resync with the same epoch", async () => {
    const { store, engine } = setup([
      pullPage({ reset: true, rev: 2 }),
      pullPage({
        rev: 2,
        records: [{ kind: "search", key: "kept", payload: { query: "kept" }, event_time_ms: 1, deleted: false, rev: 2 }],
      }),
    ]);
    store.update((state) => ({
      ...state,
      epoch: "e1",
      cursor: 1,
      records: {
        "search|kept": { kind: "search", key: "kept", payload: { query: "kept" }, eventTimeMs: 1, deleted: false, dirty: false, synced: true },
        "search|gone": { kind: "search", key: "gone", payload: { query: "gone" }, eventTimeMs: 1, deleted: false, dirty: false, synced: true },
      },
    }));

    await engine.requestSync("launch");

    expect(store.get("search", "kept")).not.toBeNull();
    expect(store.get("search", "gone")).toBeNull();
    engine.stop();
  });

  it("reloads the store before a cycle so another tab's changes are pushed", async () => {
    const storage = memoryStorage();
    const scopeKey = syncScopeKey("http://localhost:3000", 1);
    const store = createSyncStore({ storage, scopeKey, username: "alice" });
    const otherTab = createSyncStore({ storage, scopeKey, username: "alice" });
    const push = jest.fn(async (body: SyncPushRequest) => applied(body));
    const engine = createSyncEngine({ transport: { push, pull: jest.fn(async () => pullPage()) }, classifyError, store });
    engine.start();
    otherTab.upsert("search", { query: "from another tab" });

    await engine.requestSync("launch");

    expect(push.mock.calls[0]![0].changes).toMatchObject([{ payload: { query: "from another tab" } }]);
    engine.stop();
  });

  it("stops and reports when the session is unauthorized", async () => {
    const { engine, onUnauthorized, pull } = setup([new FakeSyncError("unauthorized")]);
    await engine.requestSync("launch");
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await engine.requestSync("foreground");
    expect(pull).toHaveBeenCalledTimes(1);
  });

  it("retries with backoff after a network error", async () => {
    const { engine, pull } = setup([new Error("offline"), new Error("offline")]);
    await engine.requestSync("launch");
    expect(pull).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2_000);
    expect(pull).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(3_999);
    expect(pull).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(pull).toHaveBeenCalledTimes(3);
    engine.stop();
  });

  it("leaves local changes to a pending retry instead of bypassing the backoff", async () => {
    const { store, engine, pull, push } = setup([new Error("offline"), new Error("offline")]);
    await engine.requestSync("launch");
    await jest.advanceTimersByTimeAsync(2_000);
    expect(pull).toHaveBeenCalledTimes(2);

    store.upsert("search", { query: "during backoff" });
    await jest.advanceTimersByTimeAsync(3_999);
    expect(push).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(push).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it("leaves the store alone when stopped while a request is in flight", async () => {
    const { store, engine, push } = setup();
    let release: (response: SyncPushResponse) => void = () => undefined;
    push.mockImplementationOnce((body) => new Promise((resolve) => (release = () => resolve(applied(body)))));
    store.upsert("search", { query: "late" });

    const cycle = engine.requestSync("launch");
    await jest.advanceTimersByTimeAsync(0);
    engine.stop();
    release(applied({ epoch: "", cursor: 0, changes: [] }));
    await cycle;

    expect(store.state().records["search|late"]).toMatchObject({ dirty: true, synced: false });
    expect(store.state().epoch).toBe("");
  });

  it("lets a page entry join a running cycle without queueing another", async () => {
    const { engine, pull } = setup();
    let release: (page: SyncPullResponse) => void = () => undefined;
    pull.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const launch = engine.requestSync("launch");
    await jest.advanceTimersByTimeAsync(0);
    const page = engine.requestSync("page");
    release(pullPage());
    await Promise.all([launch, page]);
    expect(pull).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it("throttles page syncs to once per 30 seconds", async () => {
    const { engine, pull } = setup();
    await engine.requestSync("page");
    await engine.requestSync("page");
    expect(pull).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(30_000);
    await engine.requestSync("page");
    expect(pull).toHaveBeenCalledTimes(2);
    engine.stop();
  });

  it("debounces local changes and throttles watch pushes", async () => {
    const { store, engine, push } = setup();
    store.upsert("search", { query: "a" });
    await jest.advanceTimersByTimeAsync(1_999);
    expect(push).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(push).toHaveBeenCalledTimes(1);

    store.upsert("watch", watch);
    await jest.advanceTimersByTimeAsync(27_000);
    expect(push).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(3_000);
    expect(push).toHaveBeenCalledTimes(2);
    engine.stop();
  });

  it("flushes one keepalive push under the byte budget, newest first", async () => {
    const { store, engine, pushes } = setup();
    for (let i = 0; i < 150; i += 1) {
      store.upsert("search", { query: `q${String(i).padStart(3, "0")} ${"x".repeat(500)}` });
      jest.advanceTimersByTime(1);
    }
    await engine.flushNow({ keepalive: true });
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.keepalive).toBe(true);
    const changes = pushes[0]!.body.changes;
    expect(changes.length).toBeLessThan(150);
    expect(JSON.stringify(changes).length).toBeLessThanOrEqual(SYNC_KEEPALIVE_MAX_BYTES);
    expect(changes[0]).toMatchObject({ payload: { query: expect.stringMatching(/^q149 /) } });
    engine.stop();
  });

  it("shares one flush between overlapping flush requests", async () => {
    const { store, engine, push } = setup();
    store.upsert("search", { query: "once" });
    await Promise.all([engine.flushNow(), engine.flushNow()]);
    expect(push).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it("sends a keepalive flush even while a regular flush is in flight", async () => {
    const { store, engine, push } = setup();
    let release: () => void = () => undefined;
    push.mockImplementationOnce((body) => new Promise((resolve) => (release = () => resolve(applied(body)))));
    store.upsert("search", { query: "pending" });

    const regular = engine.flushNow();
    await jest.advanceTimersByTimeAsync(0);
    await engine.flushNow({ keepalive: true });

    expect(push).toHaveBeenCalledTimes(2);
    expect(push.mock.calls[1]![1]).toEqual({ keepalive: true });
    release();
    await regular;
    engine.stop();
  });

  it("runs a full cycle when a flush hits a conflict", async () => {
    const { store, engine, push } = setup([pullPage({ epoch: "e2", reset: true }), pullPage({ epoch: "e2", rev: 1 })]);
    store.upsert("search", { query: "q" });
    store.update((state) => ({ ...state, epoch: "e1", cursor: 4 }));
    push.mockImplementation(async (body) => {
      if (body.epoch === "e1") throw new FakeSyncError("conflict");
      return applied(body);
    });

    await engine.flushNow();

    expect(store.state().records["search|q"]).toMatchObject({ dirty: false, synced: true });
    expect(push.mock.calls.at(-1)![0]).toMatchObject({ epoch: "e2", cursor: 0 });
    engine.stop();
  });

  it("logs changes the server rejected as invalid", async () => {
    const { store, engine, push } = setup();
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    push.mockImplementationOnce(async (body) => ({
      ...applied(body),
      results: [{ index: 0, status: "invalid" as const, record: null, reason: "title is too long" }],
    }));
    store.upsert("search", { query: "bad" });
    await engine.requestSync("launch");
    expect(warn).toHaveBeenCalledWith("sync change rejected as invalid", "search", "bad", "title is too long");
    warn.mockRestore();
    engine.stop();
  });

  it("reports favorites rejected by the server cap", async () => {
    const { store, engine, push, onLimit } = setup();
    push.mockImplementationOnce(async (body) => ({ ...applied(body), results: [{ index: 0, status: "limit" as const, record: null }] }));
    store.upsert("favorite", { ...favorite, title: "One Too Many" });
    await engine.requestSync("launch");
    expect(onLimit).toHaveBeenCalledWith([expect.objectContaining({ key: "one too many" })]);
    expect(store.get("favorite", "One Too Many")).toBeNull();
    engine.stop();
  });

  it("runs every cycle through runExclusive and resumes after stop and start", async () => {
    const store = createSyncStore({ storage: memoryStorage(), scopeKey: "k", username: "alice" });
    const pull = jest.fn(async () => pullPage());
    const runExclusive = jest.fn(async (task: () => Promise<void>) => task());
    const engine = createSyncEngine({ transport: { push: jest.fn(), pull }, classifyError, store, runExclusive });
    engine.start();
    await engine.requestSync("launch");
    expect(runExclusive).toHaveBeenCalledTimes(1);
    engine.stop();
    await engine.requestSync("foreground");
    expect(pull).toHaveBeenCalledTimes(1);
    engine.start();
    await engine.requestSync("foreground");
    expect(pull).toHaveBeenCalledTimes(2);
    engine.stop();
  });

  it("stays idle until start", async () => {
    const { store, engine, push, pull } = setup([], "alice", { start: false });
    store.upsert("search", { query: "before start" });
    await jest.advanceTimersByTimeAsync(SYNC_CHANGE_DEBOUNCE_MS);
    await engine.requestSync("launch");
    await engine.flushNow();
    await engine.flushNow({ keepalive: true });
    expect(push).not.toHaveBeenCalled();
    expect(pull).not.toHaveBeenCalled();

    engine.start();
    engine.start();
    await engine.requestSync("launch");
    expect(push).toHaveBeenCalledTimes(1);
    expect(pull).toHaveBeenCalledTimes(1);
    store.upsert("search", { query: "after start" });
    await jest.advanceTimersByTimeAsync(SYNC_CHANGE_DEBOUNCE_MS);
    expect(push).toHaveBeenCalledTimes(2);
    engine.stop();
  });

  it("ignores a flush response that arrives after stop and start", async () => {
    const { store, engine, push } = setup();
    let release: () => void = () => undefined;
    push.mockImplementationOnce((body) => new Promise((resolve) => (release = () => resolve(applied(body)))));
    store.upsert("search", { query: "late" });

    const flush = engine.flushNow();
    await jest.advanceTimersByTimeAsync(0);
    engine.stop();
    engine.start();
    release();
    await flush;

    expect(store.state().records["search|late"]).toMatchObject({ dirty: true, synced: false });
    expect(store.state().epoch).toBe("");
    engine.stop();
  });

  it("ignores a cycle response that arrives after stop and start", async () => {
    const { store, engine, pull } = setup();
    let release: () => void = () => undefined;
    pull.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(pullPage({ epoch: "old", rev: 7 })))));

    const cycle = engine.requestSync("launch");
    await jest.advanceTimersByTimeAsync(0);
    engine.stop();
    engine.start();
    release();
    await cycle;

    expect(store.state()).toMatchObject({ epoch: "", cursor: 0 });
    engine.stop();
  });

  it("runs a pending retry right after a successful flush", async () => {
    const { store, engine, pull, push } = setup([new Error("offline")]);
    await engine.requestSync("launch");
    expect(pull).toHaveBeenCalledTimes(1);

    store.upsert("search", { query: "while offline" });
    await engine.flushNow();
    await jest.advanceTimersByTimeAsync(0);
    expect(push).toHaveBeenCalledTimes(1);
    expect(pull).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(SYNC_RETRY_MAX_MS);
    expect(pull).toHaveBeenCalledTimes(2);
    engine.stop();
  });

  it("resets the retry backoff on start", async () => {
    const { engine, pull } = setup([new Error("offline"), new Error("offline"), new Error("offline")]);
    await engine.requestSync("launch");
    await jest.advanceTimersByTimeAsync(2_000);
    expect(pull).toHaveBeenCalledTimes(2);

    engine.stop();
    engine.start();
    await engine.requestSync("foreground");
    expect(pull).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(1_999);
    expect(pull).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(1);
    expect(pull).toHaveBeenCalledTimes(4);
    engine.stop();
  });

  it("redoes an interrupted full resync instead of resuming it as a delta pull", async () => {
    // The server purged tombstones up to rev 3; page 1 of the full resync reaches rev 3.
    //
    // 服务端清理了 rev 3 及之前的墓碑; 全量重同步的第 1 页到达 rev 3.
    const minRev = 3;
    let failPage2 = true;
    const pull = jest.fn(async ({ since }: { since: number }): Promise<SyncPullResponse> => {
      if (since > 0 && since < minRev) return pullPage({ reset: true, rev: 5 });
      if (since === 0) {
        return pullPage({
          rev: 3,
          has_more: true,
          records: [{ kind: "search", key: "kept", payload: { query: "kept" }, event_time_ms: 1, deleted: false, rev: 3 }],
        });
      }
      if (failPage2) {
        failPage2 = false;
        throw new Error("offline");
      }
      return pullPage({ rev: 5 });
    });
    const store = createSyncStore({ storage: memoryStorage(), scopeKey: "k", username: "alice" });
    store.update((state) => ({
      ...state,
      epoch: "e1",
      cursor: 1,
      records: {
        "search|kept": { kind: "search", key: "kept", payload: { query: "kept" }, eventTimeMs: 1, deleted: false, dirty: false, synced: true },
        "search|gone": { kind: "search", key: "gone", payload: { query: "gone" }, eventTimeMs: 1, deleted: false, dirty: false, synced: true },
      },
    }));
    const engine = createSyncEngine({ transport: { push: jest.fn(), pull }, classifyError, store });
    engine.start();

    await engine.requestSync("launch");
    expect(store.state().cursor).toBe(1);
    expect(store.get("search", "gone")).not.toBeNull();

    await engine.requestSync("foreground");
    expect(pull.mock.calls.map(([params]) => params.since)).toEqual([1, 0, 3, 1, 0, 3]);
    expect(store.get("search", "gone")).toBeNull();
    expect(store.get("search", "kept")).not.toBeNull();
    expect(store.state().cursor).toBe(5);
    engine.stop();
  });
});
