/**
 * storage/anonymousWatchHistory.test.ts — local anonymous watch-history regression coverage.
 *
 * storage/anonymousWatchHistory.test.ts — 本地匿名观看历史回归覆盖.
 *
 * Responsibilities / 职责:
 *   - Verify validation, ordering, tombstones, caps, snapshots, and subscription behavior
 *
 *     — 验证校验, 有序写入, 墓碑, 上限, 快照和订阅行为
 *
 *   - Guard quota and cross-tab stale-tombstone degradation paths
 *
 *     — 守护配额和跨 tab 陈旧墓碑降级路径
 *
 * Callers / 调用方:
 *   Vitest test runner — Vitest 测试运行器
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WatchHistoryPayload } from "@/api/types";

import {
  anonymousWatchHistoryKey,
  clearAnonymousWatchHistory,
  getAnonymousWatchHistory,
  getAnonymousWatchHistorySnapshot,
  subscribeAnonymousWatchHistory,
  upsertAnonymousWatchHistory,
} from "./anonymousWatchHistory";
import { nextWatchHistoryEventTime } from "./watchHistoryClock";

function payload(overrides: Partial<WatchHistoryPayload> = {}): WatchHistoryPayload {
  return {
    source_key: "source-a",
    video_id: "video-a",
    title: "Demo Show",
    cover: "",
    episode: "01",
    group_index: 0,
    episode_index: 0,
    progress_sec: 30,
    duration_sec: 120,
    completed: false,
    event_time_ms: 1_808_000_000_000,
    ...overrides,
  };
}

describe("anonymousWatchHistory", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useRealTimers();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("generates strictly increasing event times within one mocked millisecond", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_808_000_100_000);

    const first = nextWatchHistoryEventTime();
    const second = nextWatchHistoryEventTime();

    expect(second).toBe(first + 1);
  });

  it("validates payloads, deduplicates by normalized title, and rejects stale events", () => {
    expect(upsertAnonymousWatchHistory(payload({ title: " " }))).toBeNull();
    expect(upsertAnonymousWatchHistory(payload({ source_key: "" }))).toBeNull();
    expect(upsertAnonymousWatchHistory(payload({ video_id: "" }))).toBeNull();
    expect(upsertAnonymousWatchHistory(payload({ progress_sec: Number.NaN }))).toBeNull();
    expect(upsertAnonymousWatchHistory(payload({ duration_sec: -1 }))).toBeNull();
    expect(upsertAnonymousWatchHistory(payload({ group_index: -1 }))).toBeNull();
    expect(upsertAnonymousWatchHistory(payload({ event_time_ms: 0 }))).toBeNull();

    const first = nextWatchHistoryEventTime();
    expect(upsertAnonymousWatchHistory(payload({ title: " Demo Show ", progress_sec: 10, event_time_ms: first }))).toMatchObject({
      id: "anonymous:demo show",
      progress_sec: 10,
    });
    expect(upsertAnonymousWatchHistory(payload({ title: "demo show", progress_sec: 20, event_time_ms: first - 1 }))).toBeNull();
    expect(upsertAnonymousWatchHistory(payload({ title: "demo show", progress_sec: 30, event_time_ms: nextWatchHistoryEventTime() }))).toMatchObject({
      progress_sec: 30,
    });
    expect(getAnonymousWatchHistory("DEMO SHOW")).toMatchObject({ progress_sec: 30 });
    expect(getAnonymousWatchHistorySnapshot()).toHaveLength(1);
  });

  it("filters completed items, sorts by event time, and caps the home snapshot to ten incomplete entries", () => {
    for (let index = 0; index < 12; index += 1) {
      upsertAnonymousWatchHistory(
        payload({
          title: `Show ${index}`,
          video_id: `video-${index}`,
          event_time_ms: nextWatchHistoryEventTime(),
          completed: index === 11,
        }),
      );
    }

    const snapshot = getAnonymousWatchHistorySnapshot();

    expect(snapshot).toHaveLength(10);
    expect(snapshot[0]?.title).toBe("Show 10");
    expect(snapshot.some((item) => item.completed)).toBe(false);
  });

  it("accepts completed writes while hiding them from resume and home snapshots", () => {
    upsertAnonymousWatchHistory(payload({ progress_sec: 60, event_time_ms: nextWatchHistoryEventTime() }));

    const completed = upsertAnonymousWatchHistory(
      payload({
        progress_sec: 119,
        duration_sec: 120,
        completed: true,
        event_time_ms: nextWatchHistoryEventTime(),
      }),
    );

    expect(completed).toMatchObject({ completed: true, progress_sec: 119 });
    expect(getAnonymousWatchHistory("Demo Show")).toBeNull();
    expect(getAnonymousWatchHistorySnapshot()).toHaveLength(0);
  });

  it("caps persisted entries to one hundred newest items", () => {
    for (let index = 0; index < 105; index += 1) {
      upsertAnonymousWatchHistory(payload({ title: `Show ${index}`, video_id: `video-${index}`, event_time_ms: nextWatchHistoryEventTime() }));
    }

    const raw = window.localStorage.getItem(anonymousWatchHistoryKey);
    const parsed = JSON.parse(raw ?? "{}") as { entries?: Record<string, unknown> };

    expect(Object.keys(parsed.entries ?? {})).toHaveLength(100);
    expect(getAnonymousWatchHistory("Show 0")).toBeNull();
    expect(getAnonymousWatchHistory("Show 104")).not.toBeNull();
  });

  it("keeps a stable snapshot reference until a real storage change occurs", () => {
    upsertAnonymousWatchHistory(payload({ event_time_ms: nextWatchHistoryEventTime() }));
    const first = getAnonymousWatchHistorySnapshot();
    const second = getAnonymousWatchHistorySnapshot();

    expect(second).toBe(first);

    upsertAnonymousWatchHistory(payload({ title: "Other", video_id: "other", event_time_ms: nextWatchHistoryEventTime() }));
    expect(getAnonymousWatchHistorySnapshot()).not.toBe(first);
  });

  it("refreshes missed cross-tab writes when a new subscriber mounts later", () => {
    const unsubscribe = subscribeAnonymousWatchHistory(() => undefined);

    expect(getAnonymousWatchHistorySnapshot()).toHaveLength(0);
    unsubscribe();
    window.localStorage.setItem(
      anonymousWatchHistoryKey,
      JSON.stringify({
        version: 1,
        cleared_at_ms: 0,
        entries: {
          "late show": payload({
            title: "Late Show",
            video_id: "late",
            event_time_ms: nextWatchHistoryEventTime(),
          }),
        },
      }),
    );

    expect(getAnonymousWatchHistorySnapshot()).toMatchObject([{ title: "Late Show" }]);
  });

  it("notifies same-tab subscribers on successful writes and clears", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAnonymousWatchHistory(listener);

    const first = nextWatchHistoryEventTime();
    upsertAnonymousWatchHistory(payload({ event_time_ms: first }));
    upsertAnonymousWatchHistory(payload({ event_time_ms: first - 1 }));
    clearAnonymousWatchHistory();
    unsubscribe();
    upsertAnonymousWatchHistory(payload({ title: "Other", video_id: "other", event_time_ms: nextWatchHistoryEventTime() }));

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("persists a clear tombstone and rejects late pre-clear events", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const beforeClear = nextWatchHistoryEventTime();
    upsertAnonymousWatchHistory(payload({ event_time_ms: beforeClear }));

    expect(clearAnonymousWatchHistory()).toBe(true);
    expect(getAnonymousWatchHistorySnapshot()).toHaveLength(0);
    expect(upsertAnonymousWatchHistory(payload({ event_time_ms: beforeClear }))).toBeNull();
    expect(getAnonymousWatchHistorySnapshot()).toHaveLength(0);

    const persisted = JSON.parse(window.localStorage.getItem(anonymousWatchHistoryKey) ?? "{}") as { cleared_at_ms?: number };
    expect(persisted.cleared_at_ms).toBeGreaterThan(beforeClear);
  });

  it("repairs a cross-tab lower tombstone while preserving cached post-clear entries", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const beforeClear = nextWatchHistoryEventTime();
    upsertAnonymousWatchHistory(payload({ event_time_ms: beforeClear }));
    clearAnonymousWatchHistory();
    const postClear = nextWatchHistoryEventTime();
    upsertAnonymousWatchHistory(
      payload({
        title: "Fresh Show",
        video_id: "fresh",
        event_time_ms: postClear,
      }),
    );
    const listener = vi.fn();
    const unsubscribe = subscribeAnonymousWatchHistory(listener);

    window.localStorage.setItem(
      anonymousWatchHistoryKey,
      JSON.stringify({
        version: 1,
        cleared_at_ms: 100,
        entries: { "demo show": payload({ event_time_ms: beforeClear }) },
      }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: anonymousWatchHistoryKey }));

    const repaired = JSON.parse(window.localStorage.getItem(anonymousWatchHistoryKey) ?? "{}") as {
      cleared_at_ms?: number;
      entries?: Record<string, unknown>;
    };
    expect(repaired.cleared_at_ms).toBeGreaterThan(beforeClear);
    expect(repaired.entries).toEqual({
      "fresh show": expect.objectContaining({ title: "Fresh Show", event_time_ms: postClear }),
    });
    expect(getAnonymousWatchHistorySnapshot()).toMatchObject([{ title: "Fresh Show" }]);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("merges a cross-tab overwrite with fresh cached entries from this tab", () => {
    upsertAnonymousWatchHistory(
      payload({ title: "Local Show", video_id: "local", event_time_ms: nextWatchHistoryEventTime() }),
    );
    const listener = vi.fn();
    const unsubscribe = subscribeAnonymousWatchHistory(listener);

    window.localStorage.setItem(
      anonymousWatchHistoryKey,
      JSON.stringify({
        version: 1,
        cleared_at_ms: 0,
        entries: {
          "remote show": payload({
            title: "Remote Show",
            video_id: "remote",
            event_time_ms: nextWatchHistoryEventTime(),
          }),
        },
      }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: anonymousWatchHistoryKey }));

    expect(getAnonymousWatchHistorySnapshot().map((item) => item.title).sort()).toEqual([
      "Local Show",
      "Remote Show",
    ]);
    const repaired = JSON.parse(window.localStorage.getItem(anonymousWatchHistoryKey) ?? "{}") as {
      entries?: Record<string, unknown>;
    };
    expect(Object.keys(repaired.entries ?? {}).sort()).toEqual(["local show", "remote show"]);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("repairs a cross-tab removed key without lowering the cached clear tombstone", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const beforeClear = nextWatchHistoryEventTime();
    upsertAnonymousWatchHistory(payload({ event_time_ms: beforeClear }));
    clearAnonymousWatchHistory();
    const listener = vi.fn();
    const unsubscribe = subscribeAnonymousWatchHistory(listener);

    window.localStorage.removeItem(anonymousWatchHistoryKey);
    window.dispatchEvent(new StorageEvent("storage", { key: anonymousWatchHistoryKey }));

    const repaired = JSON.parse(window.localStorage.getItem(anonymousWatchHistoryKey) ?? "{}") as {
      cleared_at_ms?: number;
      entries?: Record<string, unknown>;
    };
    expect(repaired.cleared_at_ms).toBeGreaterThan(beforeClear);
    expect(upsertAnonymousWatchHistory(payload({ event_time_ms: beforeClear }))).toBeNull();
    expect(getAnonymousWatchHistorySnapshot()).toHaveLength(0);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("keeps the previous snapshot on quota failure", () => {
    upsertAnonymousWatchHistory(payload({ event_time_ms: nextWatchHistoryEventTime() }));
    const previous = getAnonymousWatchHistorySnapshot();
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    expect(upsertAnonymousWatchHistory(payload({ title: "Other", video_id: "other", event_time_ms: nextWatchHistoryEventTime() }))).toBeNull();
    expect(getAnonymousWatchHistorySnapshot()).toBe(previous);
    expect(clearAnonymousWatchHistory()).toBe(false);
    expect(getAnonymousWatchHistorySnapshot()).toBe(previous);
  });
});
