/**
 * syncMerge tests cover the client half of the sync protocol as pure state transitions.
 *
 * syncMerge 测试以纯状态转换的形式覆盖同步协议的客户端部分.
 */
import { describe, expect, it } from "vitest";

import { syncAdapter } from "./kinds";
import {
  applyCaps,
  applyPullPage,
  applyPushResults,
  collectChanges,
  compareRecords,
  finishFullResync,
  listLive,
  resetForServerLoss,
} from "./syncMerge";
import {
  emptySyncState,
  recordID,
  type LocalRecord,
  type SyncKind,
  type SyncPullResponse,
  type SyncRecordWire,
  type SyncState,
} from "./types";

function rec(kind: SyncKind, key: string, eventTimeMs: number, extra: Partial<LocalRecord> = {}): LocalRecord {
  const payload = kind === "search" ? { query: key } : syncAdapter(kind).coerce({ title: key });
  return { kind, key, payload, eventTimeMs, deleted: false, dirty: false, synced: true, ...extra } as LocalRecord;
}

function stateWith(...records: LocalRecord[]): SyncState {
  return {
    ...emptySyncState("alice"),
    epoch: "e1",
    records: Object.fromEntries(records.map((r) => [recordID(r.kind, r.key), r])),
  };
}

function wire(kind: SyncKind, key: string, eventTime: number, extra: Partial<SyncRecordWire> = {}): SyncRecordWire {
  return {
    kind,
    key,
    payload: kind === "search" ? { query: key } : { title: key },
    event_time_ms: eventTime,
    deleted: false,
    rev: 1,
    ...extra,
  };
}

function page(extra: Partial<SyncPullResponse> = {}): SyncPullResponse {
  return { epoch: "e1", server_time_ms: 1, rev: 7, reset: false, has_more: false, clears: [], records: [], ...extra };
}

describe("collectChanges", () => {
  it("sends pending clears first, then dirty records oldest first, within the limit", () => {
    const state = {
      ...stateWith(
        rec("watch", "b", 30, { dirty: true }),
        rec("favorite", "a", 10, { dirty: true, deleted: true }),
        rec("search", "c", 20, { dirty: true }),
        rec("search", "clean", 5),
      ),
      pendingClears: { search: 15 },
    };
    const batch = collectChanges(state, { limit: 3 });
    expect(batch.changes).toEqual([
      { kind: "search", op: "clear", event_time_ms: 15 },
      { kind: "favorite", op: "delete", key: "a", event_time_ms: 10 },
      { kind: "search", op: "upsert", payload: { query: "c" }, event_time_ms: 20 },
    ]);
    expect(batch.targets).toEqual([null, "favorite|a", "search|c"]);
  });

  it("stops at the byte budget but always takes the first change", () => {
    const long = "\u4e2d".repeat(400);
    const state = stateWith(
      rec("search", `a${long}`, 1, { dirty: true }),
      rec("search", `b${long}`, 2, { dirty: true }),
      rec("search", `c${long}`, 3, { dirty: true }),
    );
    expect(collectChanges(state, { maxBytes: 3_000 }).changes).toHaveLength(2);
    expect(collectChanges(state, { maxBytes: 10 }).changes).toHaveLength(1);
  });

  it("takes the newest dirty records first for a keepalive flush", () => {
    const state = stateWith(
      rec("search", "old", 1, { dirty: true }),
      rec("search", "mid", 2, { dirty: true }),
      rec("search", "new", 3, { dirty: true }),
    );
    expect(collectChanges(state, { limit: 2, newestFirst: true }).targets).toEqual(["search|new", "search|mid"]);
  });
});

describe("applyPushResults", () => {
  it("acknowledges applied changes and adopts the canonical key and event time", () => {
    const state = stateWith(rec("search", "Alpha", 10, { dirty: true, synced: false }));
    const batch = collectChanges(state);
    const { state: next } = applyPushResults(state, batch, {
      epoch: "e2",
      rev: 1,
      server_time_ms: 1,
      results: [{ index: 0, status: "applied", record: wire("search", "alpha", 9) }],
    });
    expect(next.epoch).toBe("e2");
    expect(next.records["search|Alpha"]).toBeUndefined();
    expect(next.records["search|alpha"]).toMatchObject({ dirty: false, synced: true, eventTimeMs: 9 });
  });

  it("keeps a record dirty when it changed while the push was in flight", () => {
    const state = stateWith(rec("search", "a", 10, { dirty: true }));
    const batch = collectChanges(state);
    const edited = stateWith(rec("search", "a", 11, { dirty: true }));
    const { state: next } = applyPushResults(edited, batch, {
      epoch: "e1",
      rev: 1,
      server_time_ms: 1,
      results: [{ index: 0, status: "applied", record: wire("search", "a", 10) }],
    });
    expect(next.records["search|a"]).toMatchObject({ dirty: true, eventTimeMs: 11 });
  });

  it("removes acknowledged tombstones and pending clears with the same time", () => {
    const state = {
      ...stateWith(rec("favorite", "x", 10, { dirty: true, deleted: true })),
      pendingClears: { search: 5 },
    };
    const batch = collectChanges(state);
    const { state: next } = applyPushResults(state, batch, {
      epoch: "e1",
      rev: 2,
      server_time_ms: 1,
      results: [
        { index: 0, status: "applied", record: null, clear: { kind: "search", cleared_at_ms: 5, rev: 1 } },
        { index: 1, status: "applied", record: wire("favorite", "x", 10, { deleted: true }) },
      ],
    });
    expect(next.pendingClears).toEqual({});
    expect(next.records).toEqual({});
  });

  it("adopts the server record on stale and drops the row when the server has none", () => {
    const state = stateWith(
      rec("favorite", "x", 10, { dirty: true, deleted: true }),
      rec("search", "gone", 11, { dirty: true }),
    );
    const batch = collectChanges(state);
    const { state: next } = applyPushResults(state, batch, {
      epoch: "e1",
      rev: 2,
      server_time_ms: 1,
      results: [
        { index: 0, status: "stale", record: wire("favorite", "x", 20, { payload: { title: "X", year: "2021" } }) },
        { index: 1, status: "stale", record: null },
      ],
    });
    expect(next.records["favorite|x"]).toMatchObject({ deleted: false, dirty: false, eventTimeMs: 20 });
    expect((next.records["favorite|x"]!.payload as { year: string }).year).toBe("2021");
    expect(next.records["search|gone"]).toBeUndefined();
  });

  it("clears dirty on invalid, reports it, and reports limit rejections", () => {
    const state = stateWith(rec("watch", "bad", 10, { dirty: true }), rec("favorite", "full", 11, { dirty: true }));
    const batch = collectChanges(state);
    const outcome = applyPushResults(state, batch, {
      epoch: "e1",
      rev: 0,
      server_time_ms: 1,
      results: [
        { index: 0, status: "invalid", record: null, reason: "title is too long" },
        { index: 1, status: "limit", record: null },
      ],
    });
    expect(outcome.state.records["watch|bad"]).toMatchObject({ dirty: false });
    expect(outcome.state.records["favorite|full"]).toBeUndefined();
    expect(outcome.rejected.map((r) => r.key)).toEqual(["full"]);
    expect(outcome.invalid).toEqual([{ record: expect.objectContaining({ key: "bad" }), reason: "title is too long" }]);
  });
});

describe("applyPullPage", () => {
  it("applies clears before records and follows the merge rules", () => {
    const state = stateWith(
      rec("search", "old", 5),
      rec("search", "clean", 50),
      rec("watch", "dirty-newer", 60, { dirty: true }),
      rec("watch", "dirty-older", 40, { dirty: true }),
      rec("favorite", "gone", 30),
    );
    const seen = new Set<string>();
    const next = applyPullPage(
      state,
      page({
        clears: [{ kind: "search", cleared_at_ms: 10, rev: 3 }],
        records: [
          wire("search", "clean", 55),
          wire("watch", "dirty-newer", 59),
          wire("watch", "dirty-older", 41),
          wire("favorite", "gone", 31, { deleted: true }),
          wire("favorite", "fresh", 32),
          wire("favorite", "never-seen-tombstone", 33, { deleted: true }),
        ],
      }),
      seen,
    );
    expect(next.records["search|old"]).toBeUndefined();
    expect(next.records["search|clean"]).toMatchObject({ eventTimeMs: 55 });
    expect(next.records["watch|dirty-newer"]).toMatchObject({ eventTimeMs: 60, dirty: true });
    expect(next.records["watch|dirty-older"]).toMatchObject({ eventTimeMs: 41, dirty: false });
    expect(next.records["favorite|gone"]).toBeUndefined();
    expect(next.records["favorite|fresh"]).toMatchObject({ synced: true, dirty: false });
    expect(next.records["favorite|never-seen-tombstone"]).toBeUndefined();
    expect(next.cursor).toBe(7);
    expect([...seen].sort()).toEqual(["favorite|fresh", "search|clean", "watch|dirty-newer", "watch|dirty-older"]);
  });

  it("skips remote records covered by a pending local clear", () => {
    const state = { ...stateWith(), pendingClears: { search: 20 } };
    const seen = new Set<string>();
    const next = applyPullPage(state, page({ records: [wire("search", "before", 20), wire("search", "after", 21)] }), seen);
    expect(Object.keys(next.records)).toEqual(["search|after"]);
    expect([...seen]).toEqual(["search|after"]);
  });

  it("skips records with an unknown kind", () => {
    const next = applyPullPage(
      stateWith(),
      page({ records: [{ ...wire("search", "x", 1), kind: "history" as SyncKind }] }),
      new Set(),
    );
    expect(next.records).toEqual({});
  });
});

describe("full resync and epoch reset", () => {
  it("removes only synced clean records that the full pull did not return", () => {
    const state = stateWith(
      rec("search", "kept", 1),
      rec("search", "gone", 2),
      rec("search", "local-only", 3, { synced: false, dirty: true }),
      rec("search", "dirty", 4, { dirty: true }),
    );
    const next = finishFullResync(state, new Set(["search|kept"]));
    expect(Object.keys(next.records).sort()).toEqual(["search|dirty", "search|kept", "search|local-only"]);
  });

  it("marks every record for re-upload when the server lost data", () => {
    const next = resetForServerLoss({ ...stateWith(rec("favorite", "x", 1)), cursor: 9 }, "e9", "alice");
    expect(next).toMatchObject({ epoch: "e9", cursor: 0, username: "alice" });
    expect(next.records["favorite|x"]).toMatchObject({ dirty: true, synced: false });
  });

  it("drops the data on a server loss when it belongs to another username", () => {
    const state = { ...stateWith(rec("favorite", "x", 1)), cursor: 9, clockOffsetMs: 42, pendingClears: { search: 3 } };
    const next = resetForServerLoss(state, "e9", "bob");
    expect(next).toMatchObject({ username: "bob", epoch: "e9", cursor: 0, clockOffsetMs: 42, records: {}, pendingClears: {} });
  });

  it("keeps the epoch and re-uploads on a same-epoch loss under the same username", () => {
    const state = { ...stateWith(rec("favorite", "x", 1)), epoch: "e1", cursor: 9 };
    const next = resetForServerLoss(state, "e1", state.username);
    expect(next).toMatchObject({ epoch: "e1", cursor: 0, username: state.username });
    expect(next.records["favorite|x"]).toMatchObject({ dirty: true, synced: false });
  });
});

describe("caps and listing", () => {
  it("trims search beyond 50 by event time and lists newest first", () => {
    const records = Array.from({ length: 52 }, (_, i) => rec("search", `q${String(i).padStart(2, "0")}`, i + 1));
    const next = applyCaps(stateWith(...records));
    const live = listLive(next, "search");
    expect(live).toHaveLength(50);
    expect(live[0]!.key).toBe("q51");
    expect(next.records["search|q00"]).toBeUndefined();
  });

  it("breaks event-time ties by code point, like the server's byte order", () => {
    const keys = ["\u{1F600}", "\uFF5E", "b"].map((key) => rec("search", key, 1));
    expect(keys.sort(compareRecords).map((r) => r.key)).toEqual(["b", "\uFF5E", "\u{1F600}"]);
  });

  it("never lists tombstones", () => {
    expect(listLive(stateWith(rec("favorite", "x", 1, { deleted: true })), "favorite")).toEqual([]);
  });
});
