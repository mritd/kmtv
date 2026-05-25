import { afterEach, describe, expect, it, vi } from "vitest";

import type { DetailResponse, SearchResult } from "@/api/types";

import {
  bundleFromSearchResult,
  markSourceBundleDetailFailed,
  mediaID,
  restoreSourceBundle,
  restoreSourceBundleByMedia,
  sanitizeSourceBundle,
  saveSourceBundle,
  sourceBundleStorageKey,
  sourceID,
  sourceKeyID,
  upsertSourceBundleDetail,
} from "./sourceBundles";

const result: SearchResult = {
  title: "Demo Show",
  type: "Drama",
  year: "2026",
  cover: "cover.jpg",
  desc: "demo desc",
  sources: [
    {
      source_key: "source-a",
      source_name: "Source A",
      video_id: "video-a",
      duration_ms: 120,
      episodes: [{ name: "01", url: "https://a.example/1.m3u8" }],
    },
    {
      source_key: "source-b",
      source_name: "Source B",
      video_id: "video-b",
      duration_ms: 240,
      episodes: [{ name: "01", url: "https://b.example/1.m3u8" }],
    },
  ],
};

const detail: DetailResponse = {
  id: "video-b",
  title: "Demo Show",
  type: "Drama",
  year: "2026",
  episodes: [[{ name: "01", url: "https://b.example/detail-1.m3u8" }]],
};

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("sourceBundles", () => {
  it("builds and restores a bundle by source and id", () => {
    const bundle = bundleFromSearchResult(result);

    saveSourceBundle(bundle);

    expect(bundle.version).toBe(1);
    expect(sourceID(result.sources[0])).toBe(JSON.stringify(["source-a", "video-a"]));
    expect(bundle.details[sourceID(result.sources[0])]?.status).toBe("idle");
    expect(bundle.details[sourceID(result.sources[0])]).toMatchObject({ sourceKey: "source-a", videoId: "video-a" });
    expect(bundle.details[sourceID(result.sources[0])]?.updatedAt).toEqual(expect.any(Number));
    expect(restoreSourceBundle("source-b", "video-b")?.title).toBe("Demo Show");
    expect(restoreSourceBundle("source-b", "video-b")?.sources).toHaveLength(2);
  });

  it("restores a bundle by normalized title and year", () => {
    saveSourceBundle(bundleFromSearchResult(result));

    expect(restoreSourceBundleByMedia(" demo show ", "2026")?.sources[1]?.source_key).toBe("source-b");
  });

  it("keeps detail state in memory but does not persist episode URLs", () => {
    const withDetail = upsertSourceBundleDetail(bundleFromSearchResult(result), "source-b", "video-b", detail);

    expect(withDetail.details[sourceKeyID("source-b", "video-b")]?.status).toBe("ready");
    expect(withDetail.details[sourceKeyID("source-b", "video-b")]).toMatchObject({
      sourceKey: "source-b",
      videoId: "video-b",
      updatedAt: expect.any(Number),
    });

    const failed = markSourceBundleDetailFailed(withDetail, "source-a", "video-a", "network down");
    saveSourceBundle(failed);

    const restored = restoreSourceBundle("source-a", "video-a");
    expect(restored?.details).toEqual({});
    expect(restored?.sources[0]?.episodes).toBeUndefined();
    expect(window.localStorage.getItem(sourceBundleStorageKey)).not.toContain("https://");
    expect(window.localStorage.getItem(sourceBundleStorageKey)).not.toContain("network down");
  });

  it("backfills empty bundle metadata from upserted detail", () => {
    const bundle = bundleFromSearchResult({ ...result, title: "", type: undefined, year: undefined, cover: undefined, desc: undefined });
    const withDetail = upsertSourceBundleDetail(bundle, "source-b", "video-b", {
      ...detail,
      title: "Detail Title",
      type: "Detail Type",
      year: "2027",
      cover: "detail-cover.jpg",
      desc: "detail desc",
    });

    expect(withDetail).toMatchObject({
      title: "Detail Title",
      type: "Detail Type",
      year: "2027",
      cover: "detail-cover.jpg",
      desc: "detail desc",
    });
  });

  it("ignores corrupt or unknown storage payloads", () => {
    window.localStorage.setItem(sourceBundleStorageKey, "not json");
    expect(restoreSourceBundle("source-a", "video-a")).toBeNull();
    expect(window.localStorage.getItem(sourceBundleStorageKey)).toBeNull();

    window.localStorage.setItem(sourceBundleStorageKey, JSON.stringify({ version: 999, bundles: [] }));
    expect(restoreSourceBundle("source-a", "video-a")).toBeNull();
  });

  it("ignores malformed stored bundles without throwing", () => {
    window.localStorage.setItem(
      sourceBundleStorageKey,
      JSON.stringify({
        version: 1,
        bundles: [
          { title: "Broken Show", year: "2026", sources: null, details: null, updatedAt: Date.now() },
          bundleFromSearchResult(result),
        ],
      }),
    );

    expect(() => restoreSourceBundle("source-b", "video-b")).not.toThrow();
    expect(restoreSourceBundle("source-b", "video-b")?.title).toBe("Demo Show");
    expect(restoreSourceBundle("missing", "missing")).toBeNull();
  });

  it("retains at most 30 bundles", () => {
    vi.useFakeTimers();

    for (let index = 0; index < 31; index += 1) {
      vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, index)));
      saveSourceBundle(
        bundleFromSearchResult({
          ...result,
          title: `Demo Show ${index}`,
          sources: [{ ...result.sources[0], source_key: `source-${index}`, video_id: `video-${index}` }],
        }),
      );
    }

    expect(restoreSourceBundle("source-0", "video-0")).toBeNull();
    expect(restoreSourceBundle("source-30", "video-30")?.title).toBe("Demo Show 30");
  });

  it("expires bundles older than 7 days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 8, 0, 0, 1)));
    window.localStorage.setItem(
      sourceBundleStorageKey,
      JSON.stringify({
        version: 1,
        bundles: [{ ...bundleFromSearchResult(result), updatedAt: Date.UTC(2026, 0, 1, 0, 0, 0) }],
      }),
    );

    expect(restoreSourceBundle("source-a", "video-a")).toBeNull();
  });

  it("handles localStorage read remove and write failures", () => {
    const originalStorage = window.localStorage;

    try {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: {
          clear: vi.fn(),
          getItem: vi.fn(() => {
            throw new Error("get failed");
          }),
          removeItem: vi.fn(),
          setItem: vi.fn(),
        },
      });
      expect(restoreSourceBundle("source-a", "video-a")).toBeNull();
      expect(restoreSourceBundleByMedia("Demo Show", "2026")).toBeNull();

      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: {
          clear: vi.fn(),
          getItem: vi.fn(() => "not json"),
          removeItem: vi.fn(() => {
            throw new Error("remove failed");
          }),
          setItem: vi.fn(),
        },
      });
      expect(restoreSourceBundle("source-a", "video-a")).toBeNull();

      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: {
          clear: vi.fn(),
          getItem: vi.fn(() => null),
          removeItem: vi.fn(),
          setItem: vi.fn(() => {
            throw new Error("set failed");
          }),
        },
      });
      expect(() => saveSourceBundle(bundleFromSearchResult(result))).not.toThrow();
    } finally {
      Object.defineProperty(window, "localStorage", { configurable: true, value: originalStorage });
    }
  });

  it("drops stored detail entries from restored bundles", () => {
    window.localStorage.setItem(
      sourceBundleStorageKey,
      JSON.stringify({
        version: 1,
        bundles: [
          {
            ...bundleFromSearchResult(result),
            details: {
              [sourceKeyID("source-a", "video-a")]: { status: "ready", detail: { id: "video-a", title: "Demo Show", episodes: [] } },
              [sourceKeyID("source-b", "video-b")]: { status: "ready", detail: { id: "video-b", title: "Demo Show", episodes: "bad" } },
            },
          },
        ],
      }),
    );

    const restored = restoreSourceBundle("source-a", "video-a");

    expect(restored?.details).toEqual({});
  });

  it("sanitizes navigation-state bundles while preserving episode data", () => {
    const sanitized = sanitizeSourceBundle({
      ...bundleFromSearchResult(result),
      details: {
        [sourceKeyID("source-a", "video-a")]: {
          status: "ready",
          sourceKey: "source-a",
          videoId: "video-a",
          updatedAt: Date.now(),
          detail: {
            id: "video-a",
            title: "Demo Show",
            type: "Drama",
            year: 2026,
            cover: null,
            desc: "Clean desc",
            director: ["bad"],
            actor: "Lead Actor",
            area: { bad: true },
            episodes: [[{ name: "01", url: "https://a.example/detail-1.m3u8" }]],
          },
        },
      },
    });

    const restoredDetail = sanitized?.details[sourceKeyID("source-a", "video-a")]?.detail;

    expect(restoredDetail).toEqual({
      id: "video-a",
      title: "Demo Show",
      type: "Drama",
      desc: "Clean desc",
      actor: "Lead Actor",
      episodes: [[{ name: "01", url: "https://a.example/detail-1.m3u8" }]],
    });
  });

  // mediaID helper
  // mediaID 辅助函数
  it("mediaID normalizes title case and trims whitespace", () => {
    expect(mediaID({ title: "  Demo Show  ", year: " 2026 " })).toBe("demo show:2026");
    expect(mediaID({ title: "DEMO SHOW", year: "2026" })).toBe("demo show:2026");
  });

  it("mediaID handles missing year", () => {
    expect(mediaID({ title: "No Year" })).toBe("no year:");
  });

  it("sanitizes malformed optional fields from restored sources", () => {
    window.localStorage.setItem(
      sourceBundleStorageKey,
      JSON.stringify({
        version: 1,
        bundles: [
          {
            title: "Stored Show",
            version: 1,
            year: "2026",
            updatedAt: Date.now(),
            details: {
              [sourceKeyID("source-a", "video-a")]: {
                status: "ready",
                sourceKey: "source-a",
                videoId: "video-a",
                updatedAt: Date.now(),
                detail: { id: "video-a", title: "Stored Show", episodes: [] },
              },
            },
            sources: [
              {
                source_key: "source-a",
                source_name: "Source A",
                video_id: "video-a",
                duration_ms: "bad",
                episodes: [{ name: "01", url: "https://a.example/1.m3u8" }, { name: "bad" }],
              },
              {
                source_key: "source-b",
                source_name: "Source B",
                video_id: "video-b",
                duration_ms: 240,
                episodes: "bad",
              },
            ],
          },
        ],
      }),
    );

    const restored = restoreSourceBundle("source-a", "video-a");

    expect(restored?.version).toBe(1);
    expect(restored?.details).toEqual({});
    expect(restored?.sources[0]).toEqual({
      source_key: "source-a",
      source_name: "Source A",
      video_id: "video-a",
    });
    expect(restored?.sources[1]).toEqual({
      source_key: "source-b",
      source_name: "Source B",
      video_id: "video-b",
      duration_ms: 240,
    });
  });

  // sanitizeDetail branches: failed status without error string, idle without detail, detailIdentity fallback.
  // sanitizeDetail 分支: failed 无 error 字符串, idle 无 detail, detailIdentity 回退.
  it("sanitizeSourceBundle handles detail with failed status and no error string", () => {
    const sanitized = sanitizeSourceBundle({
      ...bundleFromSearchResult(result),
      details: {
        [sourceKeyID("source-a", "video-a")]: {
          status: "failed",
          sourceKey: "source-a",
          videoId: "video-a",
          updatedAt: Date.now(),
          // error field intentionally omitted
        },
      },
    });

    const detailEntry = sanitized?.details[sourceKeyID("source-a", "video-a")];
    expect(detailEntry?.status).toBe("failed");
    expect("error" in (detailEntry ?? {})).toBe(false);
  });

  it("sanitizeSourceBundle handles idle detail without a detail response", () => {
    const sanitized = sanitizeSourceBundle({
      ...bundleFromSearchResult(result),
      details: {
        [sourceKeyID("source-a", "video-a")]: {
          status: "idle",
          sourceKey: "source-a",
          videoId: "video-a",
          updatedAt: Date.now(),
          // detail field intentionally omitted
        },
      },
    });

    const detailEntry = sanitized?.details[sourceKeyID("source-a", "video-a")];
    expect(detailEntry?.status).toBe("idle");
    expect(detailEntry?.detail).toBeUndefined();
  });

  it("sanitizeSourceBundle drops detail entries with unknown status", () => {
    const sanitized = sanitizeSourceBundle({
      ...bundleFromSearchResult(result),
      details: {
        [sourceKeyID("source-a", "video-a")]: {
          status: "unknown-status",
          sourceKey: "source-a",
          videoId: "video-a",
          updatedAt: Date.now(),
        },
      },
    });

    expect(sanitized?.details).toEqual({});
  });

  it("sanitizeSourceBundle uses JSON-parsed key when sourceKey/videoId fields are missing", () => {
    // The key is the JSON-encoded pair; the value has no explicit sourceKey/videoId.
    // 键为 JSON 编码对; 值中无显式 sourceKey/videoId 字段.
    const sanitized = sanitizeSourceBundle({
      ...bundleFromSearchResult(result),
      details: {
        [sourceKeyID("source-a", "video-a")]: {
          status: "idle",
          // no sourceKey / videoId — detailIdentity falls back to parsing the key
          updatedAt: Date.now(),
        },
      },
    });

    const detailEntry = sanitized?.details[sourceKeyID("source-a", "video-a")];
    expect(detailEntry?.sourceKey).toBe("source-a");
    expect(detailEntry?.videoId).toBe("video-a");
  });

  it("sanitizeSourceBundle drops detail entries whose key is not parseable JSON", () => {
    const sanitized = sanitizeSourceBundle({
      ...bundleFromSearchResult(result),
      details: {
        "not-json-{": {
          status: "idle",
          updatedAt: Date.now(),
        },
      },
    });

    expect(sanitized?.details).toEqual({});
  });

  it("sanitizeSourceBundle returns null for non-object value", () => {
    expect(sanitizeSourceBundle(null)).toBeNull();
    expect(sanitizeSourceBundle(42)).toBeNull();
    expect(sanitizeSourceBundle("string")).toBeNull();
  });

  it("sanitizeSourceBundle returns null when sources is empty after sanitization", () => {
    // All sources are invalid → no valid sources → null.
    // 所有 source 无效 → 无有效 source → null.
    expect(
      sanitizeSourceBundle({
        title: "Demo",
        sources: [{ bad: "data" }],
        updatedAt: Date.now(),
      }),
    ).toBeNull();
  });

  it("sameBundle deduplicates by overlapping source IDs even when mediaID differs", () => {
    // Bundle A and B have the same source-a/video-a but different titles.
    // sameBundle should treat them as the same bundle.
    // A 和 B 有相同的 source-a/video-a 但标题不同, sameBundle 应视为相同.
    const bundleA = bundleFromSearchResult({ ...result, title: "Title A" });
    const bundleB = bundleFromSearchResult({ ...result, title: "Title B", sources: [result.sources[0]] });
    saveSourceBundle(bundleA);
    saveSourceBundle(bundleB);
    // After saving bundleB with an overlapping source, bundleA should be replaced.
    // 保存 bundleB (含重叠 source) 后, bundleA 应被替换.
    expect(restoreSourceBundle("source-a", "video-a")?.title).toBe("Title B");
    // Only one bundle should be stored.
    // 只应存储一个 bundle.
    const raw = JSON.parse(window.localStorage.getItem(sourceBundleStorageKey) ?? "{}") as { bundles: unknown[] };
    expect(raw.bundles).toHaveLength(1);
  });
});
