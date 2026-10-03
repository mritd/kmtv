/**
 * sync/kinds.ts — per-kind adapters: payload coercion, record key, and local cap.
 *
 * sync/kinds.ts — 各数据类型的适配器: payload 规整, 记录 key 和本地上限.
 *
 * Server payloads are untrusted (ADR-005), so every payload passes through `coerce`. Text fields
 * are cut to the server limits (in code points) so a long title or URL never gets a change rejected.
 *
 * 服务端 payload 不可信 (ADR-005), 因此所有 payload 都经过 coerce 规整. 文本字段按服务端上限
 * (以码点计) 截断, 过长的标题或 URL 不会导致变更被拒绝.
 *
 * Shared verbatim with android/src/sync/. Import only sibling modules here.
 *
 * 与 android/src/sync/ 逐字共享. 这里只能导入同目录模块.
 */
import { normalizeSyncKey, trimSyncText } from "./normalizeKey";
import type { FavoritePayload, SearchPayload, SyncKind, SyncPayloadMap, WatchPayload } from "./types";

/**
 * KindAdapter describes how one kind is coerced, keyed, and capped.
 *
 * KindAdapter 描述某类数据如何规整, 生成 key 和限制数量.
 */
export interface KindAdapter<K extends SyncKind> {
  coerce(value: unknown): SyncPayloadMap[K];
  keyOf(payload: SyncPayloadMap[K]): string;
  cap: number | null;
}

function fields(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

// Field limits in code points, matching server/internal/model/sync.go.
//
// 字段长度上限 (以码点计), 与 server/internal/model/sync.go 一致.
const TITLE_MAX = 512;
const ID_MAX = 1024;
const COVER_MAX = 8192;
const SHORT_MAX = 64;
const DESC_MAX = 2048;

function text(value: unknown, maxCodePoints: number): string {
  if (typeof value !== "string") return "";
  const trimmed = trimSyncText(value);
  if (trimmed.length <= maxCodePoints) return trimmed;
  const chars = [...trimmed];
  return chars.length <= maxCodePoints ? trimmed : trimSyncText(chars.slice(0, maxCodePoints).join(""));
}

function index(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function seconds(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function coerceWatch(value: unknown): WatchPayload {
  const v = fields(value);
  return {
    title: text(v.title, TITLE_MAX),
    cover: text(v.cover, COVER_MAX),
    source_key: text(v.source_key, ID_MAX),
    video_id: text(v.video_id, ID_MAX),
    episode: text(v.episode, TITLE_MAX),
    group_index: index(v.group_index),
    episode_index: index(v.episode_index),
    progress_sec: seconds(v.progress_sec),
    duration_sec: seconds(v.duration_sec),
    completed: v.completed === true,
  };
}

function coerceFavorite(value: unknown): FavoritePayload {
  const v = fields(value);
  return {
    title: text(v.title, TITLE_MAX),
    cover: text(v.cover, COVER_MAX),
    type: text(v.type, SHORT_MAX),
    year: text(v.year, SHORT_MAX),
    rate: text(v.rate, SHORT_MAX),
    desc: text(v.desc, DESC_MAX),
    source_key: text(v.source_key, ID_MAX),
    video_id: text(v.video_id, ID_MAX),
  };
}

function coerceSearch(value: unknown): SearchPayload {
  return { query: text(fields(value).query, TITLE_MAX) };
}

const adapters: { [K in SyncKind]: KindAdapter<K> } = {
  watch: { coerce: coerceWatch, keyOf: (payload) => normalizeSyncKey(payload.title), cap: 200 },
  favorite: { coerce: coerceFavorite, keyOf: (payload) => normalizeSyncKey(payload.title), cap: null },
  search: { coerce: coerceSearch, keyOf: (payload) => normalizeSyncKey(payload.query), cap: 50 },
};

/**
 * syncAdapter returns the adapter for one kind.
 *
 * syncAdapter 返回某类数据的适配器.
 */
export function syncAdapter<K extends SyncKind>(kind: K): KindAdapter<K> {
  return adapters[kind];
}

/**
 * SearchResultLike is the part of a platform search result a favorite needs.
 *
 * SearchResultLike 是构造收藏所需的平台搜索结果字段.
 */
export interface SearchResultLike {
  title: string;
  cover?: string;
  type?: string;
  year?: string;
  rate?: string;
  desc?: string;
  sources?: ReadonlyArray<{ source_key: string; video_id: string }> | null;
}

/**
 * favoriteFromSearchResult builds a favorite payload from a search result and its first source.
 *
 * favoriteFromSearchResult 根据搜索结果及其第一个来源构造收藏 payload.
 */
export function favoriteFromSearchResult(result: SearchResultLike): FavoritePayload {
  const source = Array.isArray(result.sources) ? result.sources[0] : undefined;
  return coerceFavorite({
    title: result.title,
    cover: result.cover,
    type: result.type,
    year: result.year,
    rate: result.rate,
    desc: result.desc,
    source_key: source?.source_key,
    video_id: source?.video_id,
  });
}
