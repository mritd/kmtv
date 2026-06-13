// watchHistory tests cover upsert dedup, trim to 100, recent ordering, clearAll, namespace isolation.
// watchHistory 测试覆盖 upsert 去重、保留上限 100、recent 排序、clearAll 与命名空间隔离.

import { _resetForTests as _resetMMKV } from "./mmkv";
import {
  clearWatchHistory,
  loadWatchHistory,
  recordPlayProgress,
  type WatchHistoryItem,
} from "./watchHistory";

const SERVER_A = "https://a.example.com";
const SERVER_B = "https://b.example.com";

function baseItem(partial: Partial<WatchHistoryItem> = {}): Omit<WatchHistoryItem, "updatedAt"> {
  return {
    id: "id-1",
    sourceKey: "src",
    videoId: "v",
    title: "T",
    cover: "/c.jpg",
    episode: "EP1",
    episodeIndex: 0,
    progress: 0,
    duration: 1000,
    ...partial,
  };
}

beforeEach(() => {
  _resetMMKV();
});

describe("watchHistory", () => {
  it("loadWatchHistory returns [] when nothing is stored", () => {
    expect(loadWatchHistory(SERVER_A)).toEqual([]);
  });

  it("recordPlayProgress upserts by title (dedupes second write)", () => {
    recordPlayProgress(SERVER_A, baseItem({ title: "Alpha", progress: 100 }));
    recordPlayProgress(SERVER_A, baseItem({ title: "Alpha", progress: 250 }));
    const list = loadWatchHistory(SERVER_A);
    expect(list).toHaveLength(1);
    expect(list[0]!.progress).toBe(250);
  });

  it("recent ordering puts the most recently updated first", () => {
    recordPlayProgress(SERVER_A, baseItem({ title: "A" }));
    recordPlayProgress(SERVER_A, baseItem({ title: "B" }));
    const list = loadWatchHistory(SERVER_A);
    expect(list[0]!.title).toBe("B");
    expect(list[1]!.title).toBe("A");
  });

  it("loadWatchHistory caps to limit (default 10)", () => {
    for (let i = 0; i < 15; i++) {
      recordPlayProgress(SERVER_A, baseItem({ title: `T${i}` }));
    }
    expect(loadWatchHistory(SERVER_A)).toHaveLength(10);
  });

  it("trims stored history to 100 entries on upsert", () => {
    for (let i = 0; i < 105; i++) {
      recordPlayProgress(SERVER_A, baseItem({ title: `T${i}` }));
    }
    expect(loadWatchHistory(SERVER_A, 200)).toHaveLength(100);
  });

  it("clearWatchHistory empties the list", () => {
    recordPlayProgress(SERVER_A, baseItem({ title: "X" }));
    clearWatchHistory(SERVER_A);
    expect(loadWatchHistory(SERVER_A)).toEqual([]);
  });

  it("namespaces by serverURL", () => {
    recordPlayProgress(SERVER_A, baseItem({ title: "OnA" }));
    recordPlayProgress(SERVER_B, baseItem({ title: "OnB" }));
    expect(loadWatchHistory(SERVER_A).map((i) => i.title)).toEqual(["OnA"]);
    expect(loadWatchHistory(SERVER_B).map((i) => i.title)).toEqual(["OnB"]);
  });
});
