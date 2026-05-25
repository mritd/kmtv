import { beforeEach, describe, expect, test } from "vitest";

import { detailStore, detailEntryKey } from "../detailStore";

beforeEach(() => {
  detailStore.getState().resetAll();
});

describe("detailStore", () => {
  test("ensureEntry creates a fresh entry per (sourceKey, videoID)", () => {
    detailStore.getState().ensureEntry("s1", "v1");
    expect(detailStore.getState().entries[detailEntryKey("s1", "v1")]).toBeDefined();
  });

  test("ensureEntry returns the same key for repeat calls and touches the entry", async () => {
    const k1 = detailStore.getState().ensureEntry("s1", "v1");
    const firstTouched = detailStore.getState().entries[k1].lastTouched;
    // Wait a microsecond so the timestamp tick can move.
    // 等一个 tick 让时间戳前进.
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
    const k2 = detailStore.getState().ensureEntry("s1", "v1");
    expect(k1).toBe(k2);
    expect(detailStore.getState().entries[k1].lastTouched).toBeGreaterThan(firstTouched);
  });

  test("LRU evicts the least-recently-used entry when capacity exceeded", async () => {
    for (let i = 0; i < 10; i += 1) {
      detailStore.getState().ensureEntry(`s${i}`, "v");
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
    }
    const keys = Object.keys(detailStore.getState().entries);
    expect(keys).toHaveLength(8);
    expect(keys.includes(detailEntryKey("s0", "v"))).toBe(false);
    expect(keys.includes(detailEntryKey("s1", "v"))).toBe(false);
    expect(keys.includes(detailEntryKey("s9", "v"))).toBe(true);
  });

  test("dispatchPlayback routes to the entry's reducer", () => {
    const key = detailStore.getState().ensureEntry("s1", "v1");
    detailStore.getState().dispatchPlayback(key, {
      type: "selectEpisode",
      groupIndex: 0,
      episodeIndex: 0,
      episode: { name: "ep1", url: "u" },
    });
    expect(detailStore.getState().entries[key].playback.status).toBe("resolving");
  });

  test("resetEntry removes a single entry only", () => {
    const a = detailStore.getState().ensureEntry("a", "1");
    const b = detailStore.getState().ensureEntry("b", "1");
    detailStore.getState().resetEntry(a);
    expect(detailStore.getState().entries[a]).toBeUndefined();
    expect(detailStore.getState().entries[b]).toBeDefined();
  });

  test("resetAll clears every entry", () => {
    detailStore.getState().ensureEntry("a", "1");
    detailStore.getState().ensureEntry("b", "1");
    detailStore.getState().resetAll();
    expect(Object.keys(detailStore.getState().entries)).toHaveLength(0);
  });

  test("resetAllPlayback clears resolved URLs but keeps entries so settings changes re-resolve", () => {
    const key = detailStore.getState().ensureEntry("s1", "v1");
    detailStore.getState().dispatchPlayback(key, {
      type: "selectEpisode",
      groupIndex: 0,
      episodeIndex: 0,
      episode: { name: "ep1", url: "u" },
    });
    detailStore.getState().dispatchPlayback(key, { type: "resolveSuccess", url: "https://proxy/a.m3u8", mode: "proxy" });
    expect(detailStore.getState().entries[key].playback.mode).toBe("proxy");
    detailStore.getState().resetAllPlayback();
    expect(detailStore.getState().entries[key]).toBeDefined();
    expect(detailStore.getState().entries[key].playback.mode).toBeNull();
    expect(detailStore.getState().entries[key].playback.url).toBeNull();
    expect(detailStore.getState().entries[key].playback.status).toBe("idle");
  });
});
