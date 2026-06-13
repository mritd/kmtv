// episodeSelection tests — port of iOS EpisodeSelection.swift behaviour, including [safe:] fallback.
// episodeSelection 测试 — 镜像 iOS EpisodeSelection.swift 行为, 含 [safe:] 回退.

import type { SourceResult, VideoDetail } from "@/api/types";
import {
  allLines, currentEpisode, episodes, sourceDisplayName, sourceVideoID,
} from "./episodeSelection";

const ep = (name: string, url = name) => ({ name, url });
const src = (key: string, episodes: { name: string; url: string }[]): SourceResult => ({
  source_key: key, source_name: `name-${key}`, is_adult: false, video_id: `v-${key}`,
  duration_ms: 0, episodes,
});
const detail = (lines: { name: string; url: string }[][]): VideoDetail => ({
  id: "1", title: "T", type: "Movie", year: "2024", cover: "", desc: "",
  director: "", actor: "", area: "", episodes: lines,
});

test("allLines falls back to [] when detail null", () => {
  expect(allLines({ detail: null, sources: [src("a", [])], currentSourceKey: "a", currentLineIndex: 0, currentEpisodeIndex: 0 }))
    .toEqual([]);
});

test("episodes uses detail line when available, falls back to source episodes when empty", () => {
  const sel = { detail: null, sources: [src("a", [ep("E1")])], currentSourceKey: "a", currentLineIndex: 0, currentEpisodeIndex: 0 };
  expect(episodes(sel).map((e) => e.name)).toEqual(["E1"]);

  const sel2 = { ...sel, detail: detail([[ep("L1E1"), ep("L1E2")], [ep("L2E1")]]) };
  expect(episodes(sel2).map((e) => e.name)).toEqual(["L1E1", "L1E2"]);

  const sel3 = { ...sel2, currentLineIndex: 1 };
  expect(episodes(sel3).map((e) => e.name)).toEqual(["L2E1"]);

  // Out-of-range line index returns the first line (iOS [safe:] fallback).
  // currentLineIndex 越界时退回第一条线路 (iOS [safe:] 行为).
  const sel4 = { ...sel2, currentLineIndex: 99 };
  expect(episodes(sel4).map((e) => e.name)).toEqual(["L1E1", "L1E2"]);
});

test("currentEpisode honors index, returns null on out-of-range", () => {
  const sel = { detail: detail([[ep("E1"), ep("E2")]]), sources: [src("a", [])], currentSourceKey: "a", currentLineIndex: 0, currentEpisodeIndex: 1 };
  expect(currentEpisode(sel)?.name).toBe("E2");
  expect(currentEpisode({ ...sel, currentEpisodeIndex: 99 })).toBeNull();
});

test("sourceVideoID / sourceDisplayName look up from sources by currentSourceKey", () => {
  const sources = [src("a", []), src("b", [])];
  expect(sourceVideoID({ detail: null, sources, currentSourceKey: "a", currentLineIndex: 0, currentEpisodeIndex: 0 })).toBe("v-a");
  expect(sourceDisplayName({ detail: null, sources, currentSourceKey: "b", currentLineIndex: 0, currentEpisodeIndex: 0 })).toBe("name-b");
  // Missing source falls back to the key itself.
  // 缺失源时退回 key 本身.
  expect(sourceDisplayName({ detail: null, sources, currentSourceKey: "missing", currentLineIndex: 0, currentEpisodeIndex: 0 })).toBe("missing");
});
