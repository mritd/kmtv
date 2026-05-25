import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAllPlaybackProgress,
  clearPlaybackProgress,
  COMPLETION_THRESHOLD_SEC,
  getPlaybackProgress,
  MAX_PROGRESS_ENTRIES,
  playbackProgressKey,
  setPlaybackPosition,
  setPlaybackSelection,
} from "./playbackProgress";

describe("playbackProgress", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns null when no entry exists", () => {
    expect(getPlaybackProgress("douban", "abc")).toBeNull();
  });

  it("records selection and reads it back", () => {
    setPlaybackSelection("douban", "abc", 0, 3);
    const got = getPlaybackProgress("douban", "abc");
    expect(got).not.toBeNull();
    expect(got?.groupIndex).toBe(0);
    expect(got?.episodeIndex).toBe(3);
    expect(got?.positionSec).toBe(0);
  });

  it("preserves position when selection is re-applied to the same episode", () => {
    setPlaybackSelection("douban", "abc", 0, 2);
    setPlaybackPosition("douban", "abc", 0, 2, 120, 1800);
    setPlaybackSelection("douban", "abc", 0, 2);
    expect(getPlaybackProgress("douban", "abc")?.positionSec).toBe(120);
  });

  it("resets position when switching to a different episode", () => {
    setPlaybackSelection("douban", "abc", 0, 2);
    setPlaybackPosition("douban", "abc", 0, 2, 120, 1800);
    setPlaybackSelection("douban", "abc", 0, 3);
    expect(getPlaybackProgress("douban", "abc")?.positionSec).toBe(0);
    expect(getPlaybackProgress("douban", "abc")?.episodeIndex).toBe(3);
  });

  it("clears the entry when position is within COMPLETION_THRESHOLD_SEC of duration", () => {
    setPlaybackSelection("douban", "abc", 0, 1);
    setPlaybackPosition("douban", "abc", 0, 1, 1800 - COMPLETION_THRESHOLD_SEC + 1, 1800);
    expect(getPlaybackProgress("douban", "abc")).toBeNull();
  });

  it("clears the entry when position is >=95% of a short episode even if more than 30s remain", () => {
    // 24-minute episode (1440s), 95% = 1368s, 1440 - 1368 = 72s > 30s threshold; ratio gate must catch it.
    // 24 分钟一集, 95% 用比例规则匹配, 单 30 秒规则不够.
    setPlaybackSelection("douban", "ep", 0, 1);
    setPlaybackPosition("douban", "ep", 0, 1, 1380, 1440);
    expect(getPlaybackProgress("douban", "ep")).toBeNull();
  });

  it("keeps the entry for a long film when 30s rule would miss the credits but ratio still under 95%", () => {
    // 3-hour movie, paused at 2:30:00 — neither gate trips.
    // 3 小时电影, 暂停在 2:30, 两条规则都不触发.
    setPlaybackSelection("douban", "movie", 0, 0);
    setPlaybackPosition("douban", "movie", 0, 0, 9000, 10800);
    expect(getPlaybackProgress("douban", "movie")?.positionSec).toBe(9000);
  });

  it("ignores negative or non-finite positions", () => {
    setPlaybackSelection("douban", "abc", 0, 1);
    setPlaybackPosition("douban", "abc", 0, 1, -5, 1800);
    setPlaybackPosition("douban", "abc", 0, 1, Number.NaN, 1800);
    expect(getPlaybackProgress("douban", "abc")?.positionSec).toBe(0);
  });

  it("clearPlaybackProgress removes only the targeted entry", () => {
    setPlaybackSelection("a", "1", 0, 0);
    setPlaybackSelection("b", "2", 0, 0);
    clearPlaybackProgress("a", "1");
    expect(getPlaybackProgress("a", "1")).toBeNull();
    expect(getPlaybackProgress("b", "2")).not.toBeNull();
  });

  it("clearAllPlaybackProgress removes the storage key", () => {
    setPlaybackSelection("a", "1", 0, 0);
    clearAllPlaybackProgress();
    expect(window.localStorage.getItem(playbackProgressKey)).toBeNull();
  });

  it("evicts oldest entries when MAX_PROGRESS_ENTRIES is exceeded", () => {
    for (let i = 0; i < MAX_PROGRESS_ENTRIES + 5; i++) {
      setPlaybackSelection(`s${i}`, `v${i}`, 0, 0);
    }
    const stored = JSON.parse(window.localStorage.getItem(playbackProgressKey) ?? "{}") as Record<string, unknown>;
    expect(Object.keys(stored)).toHaveLength(MAX_PROGRESS_ENTRIES);
    // The earliest entries should be evicted;
    // the most recent must remain.
    // 最早写入的条目被淘汰, 最新条目保留.
    expect(stored).not.toHaveProperty("s0:v0");
    expect(stored).toHaveProperty(`s${MAX_PROGRESS_ENTRIES + 4}:v${MAX_PROGRESS_ENTRIES + 4}`);
  });

  it("discards corrupt JSON in localStorage", () => {
    window.localStorage.setItem(playbackProgressKey, "not json{");
    expect(getPlaybackProgress("anything", "anything")).toBeNull();
    expect(window.localStorage.getItem(playbackProgressKey)).toBeNull();
  });

  // Blank key guards — all write/read functions ignore empty sourceKey or videoID.
  // 空键保护 — 所有读写函数忽略空 sourceKey 或 videoID.
  it("getPlaybackProgress returns null for blank sourceKey", () => {
    expect(getPlaybackProgress("", "abc")).toBeNull();
  });

  it("getPlaybackProgress returns null for blank videoID", () => {
    expect(getPlaybackProgress("src", "")).toBeNull();
  });

  it("setPlaybackSelection ignores blank sourceKey", () => {
    setPlaybackSelection("", "abc", 0, 0);
    expect(window.localStorage.getItem(playbackProgressKey)).toBeNull();
  });

  it("setPlaybackSelection ignores blank videoID", () => {
    setPlaybackSelection("src", "", 0, 0);
    expect(window.localStorage.getItem(playbackProgressKey)).toBeNull();
  });

  it("setPlaybackPosition ignores blank sourceKey", () => {
    setPlaybackPosition("", "abc", 0, 0, 60, 1800);
    expect(window.localStorage.getItem(playbackProgressKey)).toBeNull();
  });

  it("setPlaybackPosition ignores blank videoID", () => {
    setPlaybackPosition("src", "", 0, 0, 60, 1800);
    expect(window.localStorage.getItem(playbackProgressKey)).toBeNull();
  });

  it("clearPlaybackProgress ignores blank keys without throwing", () => {
    expect(() => clearPlaybackProgress("", "")).not.toThrow();
  });

  // Duration preservation — when durationSec is invalid on a position update, fall back to previously known value.
  // 时长保留 — 位置更新时若 durationSec 无效, 回退到先前已知值.
  it("preserves previously known durationSec when current durationSec is 0", () => {
    setPlaybackSelection("s", "v", 0, 0);
    setPlaybackPosition("s", "v", 0, 0, 60, 1800);
    // Subsequent call with durationSec=0 should keep the stored 1800.
    // 后续调用 durationSec=0 时应保留已存储的 1800.
    setPlaybackPosition("s", "v", 0, 0, 90, 0);
    expect(getPlaybackProgress("s", "v")?.durationSec).toBe(1800);
  });

  it("preserves previously known durationSec when current durationSec is NaN", () => {
    setPlaybackSelection("s", "v", 0, 0);
    setPlaybackPosition("s", "v", 0, 0, 60, 1800);
    setPlaybackPosition("s", "v", 0, 0, 90, Number.NaN);
    expect(getPlaybackProgress("s", "v")?.durationSec).toBe(1800);
  });

  // Ratio gate — exactly at 95% boundary.
  // 比例门槛 — 恰好在 95% 边界.
  it("clears entry when position is exactly at the 95% ratio boundary", () => {
    setPlaybackSelection("s", "v", 0, 0);
    setPlaybackPosition("s", "v", 0, 0, 1800 * 0.95, 1800);
    expect(getPlaybackProgress("s", "v")).toBeNull();
  });

  it("keeps entry when position is just below 95% and more than 30s remain", () => {
    // 2-hour film, position at 94% (6768s of 7200s), 432s remaining > 30s.
    // 2 小时电影, 进度 94% (6768/7200), 剩余 432 秒 > 30 秒.
    setPlaybackSelection("s", "v", 0, 0);
    setPlaybackPosition("s", "v", 0, 0, 7200 * 0.94, 7200);
    expect(getPlaybackProgress("s", "v")).not.toBeNull();
  });

  // localStorage write quota failure — writeMap swallows the error.
  // localStorage 写入配额失败 — writeMap 静默吞掉错误.
  it("does not throw when localStorage.setItem throws during setPlaybackSelection", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => setPlaybackSelection("s", "v", 0, 0)).not.toThrow();
    spy.mockRestore();
  });

  // Malformed stored map — isProgressMap returns false for a map with non-object values.
  // 存储 map 格式错误 — 含有非对象值时 isProgressMap 返回 false.
  it("discards a stored map where entries fail type validation", () => {
    window.localStorage.setItem(playbackProgressKey, JSON.stringify({ "s:v": { groupIndex: "bad" } }));
    expect(getPlaybackProgress("s", "v")).toBeNull();
  });

  it("discards a stored map where top-level value is not an object", () => {
    window.localStorage.setItem(playbackProgressKey, JSON.stringify([1, 2, 3]));
    expect(getPlaybackProgress("s", "v")).toBeNull();
  });

  it("discards an empty array in localStorage — isProgressMap must reject arrays", () => {
    // An empty [] passes typeof===object and Object.values([])===[], which would otherwise
    // allow writeMap to silently lose data (JSON.stringify([]) drops named properties).
    // 空数组 typeof===object 且 Object.values([])===[], 若不拦截则 writeMap 静默丢失数据.
    window.localStorage.setItem(playbackProgressKey, JSON.stringify([]));
    expect(getPlaybackProgress("s", "v")).toBeNull();
  });
});
