/**
 * Tests for detailStore — per-video detail and playback state with LRU eviction.
 * detailStore 测试 — 带 LRU 淘汰的逐视频详情与播放状态 store.
 *
 * Baseline coverage was 71.66% statements / 46.15% branches.
 * Uncovered lines per baseline-coverage.txt: 76-86 (touch/guard paths), 115-117 (updateEntry guard).
 *
 * This file targets those gaps: unknown-key guards on touch(), setBundle(), setSelectedSourceID(),
 * setPendingEpisodeSelection(), dispatchPlayback(), resetEntry(), and updateEntry() — plus
 * a comprehensive pass over happy paths and hasResolved=false branch.
 *
 * 基线覆盖率: statements 71.66% / branches 46.15%.
 * 未覆盖行 (baseline-coverage.txt): 76-86 (touch/guard 路径), 115-117 (updateEntry guard).
 * 本文件重点覆盖: touch()、setBundle()、setSelectedSourceID()、setPendingEpisodeSelection()、
 * dispatchPlayback()、resetEntry() 的未知 key 防护, 以及 updateEntry() 的 guard, 另含 hasResolved=false 分支.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { detailStore, detailEntryKey } from "./detailStore";

// ---------------------------------------------------------------------------
// Reset before each test
// 每个测试前重置
// ---------------------------------------------------------------------------

beforeEach(() => {
  detailStore.getState().resetAll();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("detailStore", () => {
  // -------------------------------------------------------------------------
  // detailEntryKey
  // -------------------------------------------------------------------------

  describe("detailEntryKey()", () => {
    it("encodes (sourceKey, videoID) as a JSON tuple", () => {
      expect(detailEntryKey("src", "vid")).toBe('["src","vid"]');
    });

    it("produces distinct keys for distinct pairs", () => {
      expect(detailEntryKey("a", "b")).not.toBe(detailEntryKey("b", "a"));
    });

    it("does not collide when a field contains a separator-like substring", () => {
      // Under the prior "a:::b" scheme this collided; JSON-tuple form keeps them distinct.
      // 旧的 "a:::b" 方案会撞 key; JSON 元组形式可保持区分.
      expect(detailEntryKey("a:::b", "c")).not.toBe(detailEntryKey("a", "b:::c"));
      expect(detailEntryKey("a\"b", "c")).not.toBe(detailEntryKey("a", "b\"c"));
    });
  });

  // -------------------------------------------------------------------------
  // ensureEntry
  // -------------------------------------------------------------------------

  describe("ensureEntry()", () => {
    it("creates a fresh entry with blank state on first call", () => {
      const key = detailStore.getState().ensureEntry("s1", "v1");
      const entry = detailStore.getState().entries[key];
      expect(entry).toBeDefined();
      expect(entry.sourceKey).toBe("s1");
      expect(entry.videoID).toBe("v1");
      expect(entry.bundle).toBeNull();
      expect(entry.hasResolvedBundle).toBe(false);
      expect(entry.selectedSourceID).toBeNull();
      expect(entry.pendingEpisodeSelection).toBeNull();
      expect(entry.playback.status).toBe("idle");
    });

    it("returns the same key on repeat calls and bumps lastTouched", async () => {
      const k1 = detailStore.getState().ensureEntry("s1", "v1");
      const before = detailStore.getState().entries[k1].lastTouched;
      await new Promise<void>((resolve) => { setTimeout(resolve, 2); });
      const k2 = detailStore.getState().ensureEntry("s1", "v1");
      expect(k1).toBe(k2);
      // lastTouched must increase on the second ensureEntry call.
      // 第二次调用 ensureEntry 后 lastTouched 必须增加.
      expect(detailStore.getState().entries[k1].lastTouched).toBeGreaterThan(before);
    });

    it("evicts the LRU entry when the cache exceeds 8 slots", async () => {
      // Insert 9 entries sequentially with delays so timestamps are distinct.
      // 按顺序插入 9 条条目, 加延迟确保时间戳各异.
      for (let i = 0; i < 9; i += 1) {
        detailStore.getState().ensureEntry(`src${i}`, "vid");
        await new Promise<void>((resolve) => { setTimeout(resolve, 1); });
      }
      const keys = Object.keys(detailStore.getState().entries);
      expect(keys).toHaveLength(8);
      // Entry 0 was touched least recently and must have been evicted.
      // 条目 0 最近最少使用, 必须已被淘汰.
      expect(keys.includes(detailEntryKey("src0", "vid"))).toBe(false);
      expect(keys.includes(detailEntryKey("src8", "vid"))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // touch() — including the unknown-key guard (was uncovered: lines 76-79)
  // -------------------------------------------------------------------------

  describe("touch()", () => {
    it("bumps lastTouched for an existing entry", async () => {
      const key = detailStore.getState().ensureEntry("s1", "v1");
      const before = detailStore.getState().entries[key].lastTouched;
      await new Promise<void>((resolve) => { setTimeout(resolve, 2); });
      detailStore.getState().touch(key);
      expect(detailStore.getState().entries[key].lastTouched).toBeGreaterThan(before);
    });

    it("is a no-op for an unknown key (guard branch — was uncovered)", () => {
      // touch() on a non-existent key must return the exact same entries reference
      // (no spurious re-render) and must not create a phantom entry.
      // 对不存在的 key 调用 touch() 必须返回相同的 entries 引用 (避免虚假重渲染), 且不创建幽灵条目.
      const entriesBefore = detailStore.getState().entries;
      detailStore.getState().touch("no-such-key");
      // Identical reference: the reducer returned the old state object untouched.
      // 引用相同: reducer 原样返回了旧状态对象.
      expect(detailStore.getState().entries).toBe(entriesBefore);
    });
  });

  // -------------------------------------------------------------------------
  // setBundle() — including hasResolved=false branch (was uncovered: lines 81-82)
  // -------------------------------------------------------------------------

  describe("setBundle()", () => {
    it("stores the bundle and sets hasResolvedBundle=true by default", () => {
      const key = detailStore.getState().ensureEntry("s1", "v1");
      const fakeBundle = { sources: [] } as unknown as import("@/storage/sourceBundles").SourceBundle;
      detailStore.getState().setBundle(key, fakeBundle);
      const entry = detailStore.getState().entries[key];
      expect(entry.bundle).toBe(fakeBundle);
      expect(entry.hasResolvedBundle).toBe(true);
    });

    it("stores the bundle with hasResolvedBundle=false when explicitly passed (was uncovered)", () => {
      // Pass hasResolved=false for partial/preview bundles that should allow a later re-fetch.
      // 对部分/预览 bundle 传 hasResolved=false, 允许后续再次拉取.
      const key = detailStore.getState().ensureEntry("s1", "v1");
      const fakeBundle = { sources: [] } as unknown as import("@/storage/sourceBundles").SourceBundle;
      detailStore.getState().setBundle(key, fakeBundle, false);
      expect(detailStore.getState().entries[key].hasResolvedBundle).toBe(false);
    });

    it("is a no-op for an unknown key (guard via updateEntry — was uncovered)", () => {
      // updateEntry returns state unchanged when the key is absent.
      // updateEntry 在 key 不存在时原样返回状态.
      const fakeBundle = { sources: [] } as unknown as import("@/storage/sourceBundles").SourceBundle;
      const before = { ...detailStore.getState().entries };
      detailStore.getState().setBundle("no-such-key", fakeBundle);
      expect(detailStore.getState().entries).toEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  // setSelectedSourceID() — unknown-key guard (was uncovered: via updateEntry line 115-117)
  // -------------------------------------------------------------------------

  describe("setSelectedSourceID()", () => {
    it("records the selected source for an existing entry", () => {
      const key = detailStore.getState().ensureEntry("s1", "v1");
      detailStore.getState().setSelectedSourceID(key, "source-abc");
      expect(detailStore.getState().entries[key].selectedSourceID).toBe("source-abc");
    });

    it("is a no-op for an unknown key (guard via updateEntry — was uncovered)", () => {
      // updateEntry guard: key not present → return state unchanged.
      // updateEntry 防护: key 不存在 → 原样返回状态.
      const before = { ...detailStore.getState().entries };
      detailStore.getState().setSelectedSourceID("no-such-key", "source-abc");
      expect(detailStore.getState().entries).toEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  // setPendingEpisodeSelection() — unknown-key guard + null-clear branch
  // -------------------------------------------------------------------------

  describe("setPendingEpisodeSelection()", () => {
    it("sets a pending cross-source episode selection", () => {
      const key = detailStore.getState().ensureEntry("s1", "v1");
      const selection = { sourceKey: "s2", videoID: "v2", episodeIndex: 3 };
      detailStore.getState().setPendingEpisodeSelection(key, selection);
      expect(detailStore.getState().entries[key].pendingEpisodeSelection).toEqual(selection);
    });

    it("clears the pending selection when set to null", () => {
      const key = detailStore.getState().ensureEntry("s1", "v1");
      detailStore.getState().setPendingEpisodeSelection(key, { sourceKey: "s2", videoID: "v2", episodeIndex: 1 });
      detailStore.getState().setPendingEpisodeSelection(key, null);
      expect(detailStore.getState().entries[key].pendingEpisodeSelection).toBeNull();
    });

    it("is a no-op for an unknown key (guard via updateEntry — was uncovered)", () => {
      const before = { ...detailStore.getState().entries };
      detailStore.getState().setPendingEpisodeSelection("no-such-key", { sourceKey: "s", videoID: "v", episodeIndex: 0 });
      expect(detailStore.getState().entries).toEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  // dispatchPlayback() — unknown-key guard (was uncovered: lines 88-89)
  // -------------------------------------------------------------------------

  describe("dispatchPlayback()", () => {
    it("routes a selectEpisode action through playbackReducer", () => {
      const key = detailStore.getState().ensureEntry("s1", "v1");
      detailStore.getState().dispatchPlayback(key, {
        type: "selectEpisode",
        groupIndex: 0,
        episodeIndex: 0,
        episode: { name: "ep1", url: "https://cdn/ep1.m3u8" },
      });
      expect(detailStore.getState().entries[key].playback.status).toBe("resolving");
      expect(detailStore.getState().entries[key].playback.selectedEpisode?.name).toBe("ep1");
    });

    it("is a no-op for an unknown key (guard branch — was uncovered)", () => {
      // dispatchPlayback on a missing entry must not create a phantom entry.
      // 对不存在的条目调用 dispatchPlayback 不应创建幽灵条目.
      const before = { ...detailStore.getState().entries };
      detailStore.getState().dispatchPlayback("no-such-key", { type: "reset" });
      expect(detailStore.getState().entries).toEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  // resetEntry() — unknown-key guard (was uncovered: line 97)
  // -------------------------------------------------------------------------

  describe("resetEntry()", () => {
    it("removes only the targeted entry when it exists", () => {
      const keyA = detailStore.getState().ensureEntry("a", "1");
      const keyB = detailStore.getState().ensureEntry("b", "1");
      detailStore.getState().resetEntry(keyA);
      expect(detailStore.getState().entries[keyA]).toBeUndefined();
      expect(detailStore.getState().entries[keyB]).toBeDefined();
    });

    it("is a no-op for an unknown key (guard branch — was uncovered)", () => {
      // Calling resetEntry with a stale key must not throw or corrupt state.
      // 用陈旧 key 调用 resetEntry 不应抛出异常或破坏状态.
      detailStore.getState().ensureEntry("a", "1");
      const before = { ...detailStore.getState().entries };
      detailStore.getState().resetEntry("no-such-key");
      expect(detailStore.getState().entries).toEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  // resetAll()
  // -------------------------------------------------------------------------

  describe("resetAll()", () => {
    it("clears every entry in the cache", () => {
      detailStore.getState().ensureEntry("a", "1");
      detailStore.getState().ensureEntry("b", "2");
      detailStore.getState().resetAll();
      expect(Object.keys(detailStore.getState().entries)).toHaveLength(0);
    });

    it("is idempotent on an already empty cache", () => {
      detailStore.getState().resetAll();
      detailStore.getState().resetAll();
      expect(detailStore.getState().entries).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  // resetAllPlayback()
  // -------------------------------------------------------------------------

  describe("resetAllPlayback()", () => {
    it("resets playback state to idle for every entry without removing them", () => {
      const key = detailStore.getState().ensureEntry("s1", "v1");
      detailStore.getState().dispatchPlayback(key, {
        type: "selectEpisode",
        groupIndex: 0,
        episodeIndex: 0,
        episode: { name: "ep1", url: "u" },
      });
      detailStore.getState().dispatchPlayback(key, { type: "resolveSuccess", url: "https://proxy/a.m3u8", mode: "proxy" });
      expect(detailStore.getState().entries[key].playback.status).toBe("ready");

      detailStore.getState().resetAllPlayback();

      const entry = detailStore.getState().entries[key];
      expect(entry).toBeDefined();
      expect(entry.playback.status).toBe("idle");
      expect(entry.playback.url).toBeNull();
      expect(entry.playback.mode).toBeNull();
    });

    it("is a no-op on an empty cache (no throw)", () => {
      // resetAllPlayback must iterate over an empty entries object safely.
      // resetAllPlayback 必须能安全地遍历空 entries 对象.
      expect(() => { detailStore.getState().resetAllPlayback(); }).not.toThrow();
    });

    it("preserves bundle and selection data while resetting playback", () => {
      const key = detailStore.getState().ensureEntry("s1", "v1");
      detailStore.getState().setSelectedSourceID(key, "src-xyz");
      detailStore.getState().dispatchPlayback(key, {
        type: "selectEpisode",
        groupIndex: 0,
        episodeIndex: 0,
        episode: { name: "ep1", url: "u" },
      });

      detailStore.getState().resetAllPlayback();

      const entry = detailStore.getState().entries[key];
      // Non-playback fields must be preserved.
      // 非播放字段必须被保留.
      expect(entry.selectedSourceID).toBe("src-xyz");
    });
  });
});
