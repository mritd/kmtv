/**
 * storage/sourceBundles.ts — ephemeral source bundle cache backed by localStorage.
 *
 * storage/sourceBundles.ts — 基于 localStorage 的临时 source bundle 缓存.
 *
 * localStorage key: "kmtv.sourceBundles.v1"
 * Schema: { version: 1, bundles: SourceBundle[] }
 *   — version field guards against future schema changes; unknown versions are silently ignored
 *   — key name and version number are Tier 4 locked; do NOT rename or change either
 *
 * Persistence rules (enforced on every read and write):
 *   - Episode URLs are stripped before persisting (privacy + size).
 *   - Detail state (status/error/full detail) is stripped before persisting (best-effort cache).
 *   - At most 30 bundles are retained; oldest (by updatedAt) are evicted first.
 *   - Bundles older than 7 days are discarded on read.
 *
 * 持久化规则 (每次读写时强制执行):
 *   - 持久化前删除集数 URL (隐私 + 体积).
 *   - 持久化前删除 detail 状态 (best-effort 缓存, 非持久数据).
 *   - 最多保留 30 个 bundle; 按 updatedAt 淘汰最旧的.
 *   - 读取时丢弃超过 7 天的 bundle.
 *
 * Callers: viewer/detail/DetailPage (read/write), viewer/search/SearchResults (write),
 *          viewer/home/RecommendedSection (write).
 */
import type { DetailResponse, SearchResult, SourceResult } from "@/api/types";

// storageVersion is embedded in every stored record and must match the version field in isStore().
// Bumping this value intentionally invalidates all legacy stored bundles (migration-free fresh start).
// storageVersion 嵌入每条存储记录并必须与 isStore() 中的 version 字段匹配.
// 提升该值会有意使所有旧存储 bundle 失效 (免迁移冷启动).
const storageVersion = 1;

// maxBundles caps the number of bundles written per session.
// maxBundles 限制每次会话写入的 bundle 数量上限.
const maxBundles = 30;

// maxBundleAgeMs — bundles older than 7 days are treated as stale and discarded on read.
// maxBundleAgeMs — 超过 7 天的 bundle 视为过期, 读取时丢弃.
const maxBundleAgeMs = 7 * 24 * 60 * 60 * 1000;

// LOCKED storage key — must not change. Renaming breaks existing user data.
// 锁定的存储键 — 禁止更改, 重命名会破坏现有用户数据.
export const sourceBundleStorageKey = "kmtv.sourceBundles.v1";

/**
 * SourceBundleDetailStatus represents the fetch state for a single source's detail.
 * "idle"  — not yet fetched (may include inline episode data from the search result).
 * "ready" — detail fetch succeeded; full DetailResponse available.
 * "failed"— detail fetch failed; error string is present when available, otherwise absent.
 *
 * SourceBundleDetailStatus 表示单个 source detail 的获取状态.
 * "idle"  — 尚未获取 (可能包含搜索结果中的内联集数数据).
 * "ready" — detail 获取成功; 完整 DetailResponse 可用.
 * "failed"— detail 获取失败; error 字符串在有的情况下存在, 否则缺省.
 */
export type SourceBundleDetailStatus = "idle" | "ready" | "failed";

/**
 * SourceBundleDetail holds the fetch state and optional detail payload for one source entry.
 * This field is NOT persisted to localStorage — it is in-memory only.
 * On restore from storage the details map is always {}.
 *
 * SourceBundleDetail 保存单个 source 条目的获取状态和可选的 detail 负载.
 * 此字段不会持久化到 localStorage — 仅存在于内存中.
 * 从存储恢复时 details map 始终为 {}.
 */
export interface SourceBundleDetail {
  status: SourceBundleDetailStatus;
  sourceKey: string;
  videoId: string;
  updatedAt: number;
  detail?: DetailResponse;
  error?: string;
}

/**
 * SourceBundle aggregates a title's metadata, its known sources, and their in-memory detail state.
 * The version field is stored and round-tripped, but per-bundle version checking is NOT done by
 * sanitizeBundle — the store-level isStore() gate rejects the whole payload when the outer envelope
 * version mismatches. Individual bundles are accepted regardless of their own version field; the
 * field is overwritten to storageVersion on every sanitize/write pass.
 *
 * SourceBundle 聚合了一个标题的元数据、已知 source 列表和内存中的 detail 状态.
 * version 字段被存储并往返, 但 sanitizeBundle 不做逐 bundle 的版本检查 —
 * isStore() 在外层 envelope version 不匹配时拒绝整个负载.
 * 每个 bundle 自身的 version 字段在每次净化/写入时都被覆写为 storageVersion.
 */
export interface SourceBundle {
  version: typeof storageVersion;
  title: string;
  type?: string;
  year?: string;
  cover?: string;
  desc?: string;
  rate?: string;
  sources: SourceResult[];
  details: Record<string, SourceBundleDetail>;
  updatedAt: number;
}

// SourceBundleStore is the top-level localStorage envelope.
// SourceBundleStore 是 localStorage 的顶层封装结构.
interface SourceBundleStore {
  version: typeof storageVersion;
  bundles: SourceBundle[];
}

// StoredRecord is the parsed-but-unvalidated shape of any unknown JSON object from storage.
// StoredRecord 是从存储读取到的任意未经验证的 JSON 对象形状.
type StoredRecord = Record<string, unknown>;

// DetailOptionalStringKey enumerates the string fields that may optionally appear on DetailResponse.
// DetailOptionalStringKey 枚举 DetailResponse 上可选的字符串字段.
type DetailOptionalStringKey = "type" | "year" | "cover" | "desc" | "director" | "actor" | "area";

// SanitizeOptions controls whether episode data is preserved during sanitization.
// When restoring from localStorage, keepEpisodeData is false — URLs are stripped for privacy.
// When sanitizing in-memory navigation state (sanitizeSourceBundle), keepEpisodeData is true.
// SanitizeOptions 控制净化时是否保留集数数据.
// 从 localStorage 恢复时, keepEpisodeData 为 false — 删除 URL 保护隐私.
// 净化内存中的导航状态 (sanitizeSourceBundle) 时, keepEpisodeData 为 true.
interface SanitizeOptions {
  keepEpisodeData: boolean;
}

/**
 * sourceKeyID returns a stable JSON-encoded identity for a (sourceKey, videoId) pair.
 * Used as the key in SourceBundle.details maps.
 *
 * sourceKeyID 返回 (sourceKey, videoId) 对的稳定 JSON 编码标识.
 * 用作 SourceBundle.details map 的键.
 */
export function sourceKeyID(sourceKey: string, videoId: string): string {
  return JSON.stringify([sourceKey, videoId]);
}

/**
 * sourceID returns the stable identity for a SourceResult.
 * Delegates to sourceKeyID; provided as a convenience for callers that already have a SourceResult.
 *
 * sourceID 返回 SourceResult 的稳定标识.
 * 委托给 sourceKeyID; 方便已有 SourceResult 的调用方使用.
 */
export function sourceID(source: SourceResult): string {
  return sourceKeyID(source.source_key, source.video_id);
}

/**
 * mediaID returns a normalized media-level identity for deduplication across sources.
 * Uses the same trim + toLocaleLowerCase normalization as favorites.mediaFavoriteID.
 *
 * mediaID 返回规范化的媒体级标识, 用于跨 source 去重.
 * 使用与 favorites.mediaFavoriteID 相同的 trim + toLocaleLowerCase 规范化.
 */
export function mediaID({ title, year }: Pick<SearchResult, "title" | "year">): string {
  return `${title.trim().toLocaleLowerCase()}:${year?.trim() ?? ""}`;
}

/**
 * bundleFromSearchResult builds an initial SourceBundle from a SearchResult.
 * Sources that include inline episode data (from the search response) get a pre-populated
 * "idle" detail entry so the UI can render episode lists before the full detail fetch completes.
 *
 * bundleFromSearchResult 从 SearchResult 构建初始 SourceBundle.
 * 含内联集数数据的 source 会预填充 "idle" detail 条目,
 * 使 UI 在完整 detail 获取完成前即可渲染集数列表.
 */
export function bundleFromSearchResult(result: SearchResult): SourceBundle {
  const details: Record<string, SourceBundleDetail> = {};
  const updatedAt = Date.now();

  for (const source of result.sources) {
    if (source.episodes?.length) {
      details[sourceID(source)] = {
        status: "idle",
        sourceKey: source.source_key,
        videoId: source.video_id,
        updatedAt,
        detail: {
          id: source.video_id,
          title: result.title,
          type: result.type,
          year: result.year,
          cover: result.cover,
          desc: result.desc,
          episodes: [source.episodes],
        },
      };
    }
  }

  return {
    version: storageVersion,
    title: result.title,
    type: result.type,
    year: result.year,
    cover: result.cover,
    desc: result.desc,
    rate: result.rate,
    sources: result.sources,
    details,
    updatedAt,
  };
}

/**
 * saveSourceBundle persists a bundle to localStorage, stripping episode URLs and detail state
 * before writing. The bundle is prepended to the list; any existing bundle for the same media
 * is removed. Old and excess bundles are trimmed automatically.
 *
 * saveSourceBundle 将 bundle 持久化到 localStorage, 写入前删除集数 URL 和 detail 状态.
 * bundle 会被前插到列表; 同一媒体的现有 bundle 会被移除. 过期和超量 bundle 自动剪枝.
 */
export function saveSourceBundle(bundle: SourceBundle): void {
  const nextBundle = persistentBundle({ ...bundle, updatedAt: Date.now() });
  const existing = readStore().filter((item) => !sameBundle(item, nextBundle));
  writeStore([nextBundle, ...existing]);
}

/**
 * sanitizeSourceBundle validates and normalizes an in-memory (not-from-storage) bundle value.
 * Preserves episode data (keepEpisodeData: true) since this path does not come from localStorage.
 * Returns null if the value cannot be coerced into a valid SourceBundle.
 *
 * sanitizeSourceBundle 验证并规范化内存中 (非存储来源) 的 bundle 值.
 * 保留集数数据 (keepEpisodeData: true), 因为此路径不来自 localStorage.
 * 如果值无法被强制转换为有效 SourceBundle, 返回 null.
 */
export function sanitizeSourceBundle(value: unknown): SourceBundle | null {
  return sanitizeBundle(value, { keepEpisodeData: true });
}

/**
 * restoreSourceBundle looks up a bundle by sourceKey + videoId from localStorage.
 * Returns null if not found, expired, or invalid.
 *
 * restoreSourceBundle 从 localStorage 按 sourceKey + videoId 查找 bundle.
 * 未找到、过期或无效时返回 null.
 */
export function restoreSourceBundle(sourceKey: string, videoId: string): SourceBundle | null {
  const id = sourceKeyID(sourceKey, videoId);
  return readStore().find((bundle) => bundle.sources.some((source) => sourceID(source) === id)) ?? null;
}

/**
 * restoreSourceBundleByMedia looks up a bundle by normalized title + year from localStorage.
 * Useful for Douban-sourced home results where sourceKey/videoId may not be known yet.
 *
 * restoreSourceBundleByMedia 从 localStorage 按规范化 title + year 查找 bundle.
 * 适用于来自 Douban 主页结果的场景, 此时 sourceKey/videoId 可能尚不可知.
 */
export function restoreSourceBundleByMedia(title: string, year?: string): SourceBundle | null {
  const id = mediaID({ title, year });
  return readStore().find((bundle) => mediaID(bundle) === id) ?? null;
}

/**
 * upsertSourceBundleDetail merges a successfully fetched DetailResponse into the bundle.
 * Back-fills title/type/year/cover/desc from the detail when the bundle fields are empty.
 * Returns a new SourceBundle (immutable update); callers must call saveSourceBundle to persist.
 *
 * upsertSourceBundleDetail 将成功获取的 DetailResponse 合并到 bundle 中.
 * bundle 字段为空时从 detail 回填 title/type/year/cover/desc.
 * 返回新的 SourceBundle (不可变更新); 调用方必须调用 saveSourceBundle 以持久化.
 */
export function upsertSourceBundleDetail(
  bundle: SourceBundle,
  sourceKey: string,
  videoId: string,
  detail: DetailResponse,
): SourceBundle {
  const updatedAt = Date.now();
  return {
    ...bundle,
    version: storageVersion,
    title: bundle.title || detail.title,
    type: bundle.type ?? detail.type,
    year: bundle.year ?? detail.year,
    cover: bundle.cover ?? detail.cover,
    desc: bundle.desc ?? detail.desc,
    details: {
      ...bundle.details,
      [sourceKeyID(sourceKey, videoId)]: { status: "ready", sourceKey, videoId, updatedAt, detail },
    },
    updatedAt,
  };
}

/**
 * markSourceBundleDetailFailed records a fetch failure for a specific source entry.
 * Returns a new SourceBundle; callers must call saveSourceBundle to persist.
 *
 * markSourceBundleDetailFailed 记录特定 source 条目的获取失败.
 * 返回新的 SourceBundle; 调用方必须调用 saveSourceBundle 以持久化.
 */
export function markSourceBundleDetailFailed(
  bundle: SourceBundle,
  sourceKey: string,
  videoId: string,
  error: string,
): SourceBundle {
  const updatedAt = Date.now();
  return {
    ...bundle,
    version: storageVersion,
    details: {
      ...bundle.details,
      [sourceKeyID(sourceKey, videoId)]: { status: "failed", sourceKey, videoId, updatedAt, error },
    },
    updatedAt,
  };
}

// readStore — parse, validate, and trim the full bundle list from localStorage.
// Returns [] on any error, unknown version, or missing key.
// readStore — 解析、验证并剪枝 localStorage 中的完整 bundle 列表.
// 任何错误、未知版本或键缺失时返回 [].
function readStore(): SourceBundle[] {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(sourceBundleStorageKey);
  } catch {
    return [];
  }
  if (!raw) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    try {
      window.localStorage.removeItem(sourceBundleStorageKey);
    } catch {
      // Ignore cleanup failures; callers should still see an empty store.
      // 忽略清理失败; 调用方仍应得到空存储.
    }
    return [];
  }

  if (!isStore(parsed)) {
    return [];
  }

  return trimBundles(parsed.bundles.map((bundle) => sanitizeBundle(bundle, { keepEpisodeData: false })).filter((bundle) => bundle !== null));
}

// writeStore — strip transient data and persist, swallowing quota errors.
// writeStore — 删除瞬态数据后持久化, 静默吞掉配额错误.
function writeStore(bundles: SourceBundle[]): void {
  const store: SourceBundleStore = { version: storageVersion, bundles: trimBundles(bundles.map(persistentBundle)) };
  try {
    window.localStorage.setItem(sourceBundleStorageKey, JSON.stringify(store));
  } catch {
    // Storage may be unavailable or full. Saving is best-effort.
    // 存储可能不可用或已满. 保存是尽力而为.
  }
}

// persistentBundle strips episode URLs (privacy) and detail state (non-persistent).
// persistentBundle 删除集数 URL (隐私保护) 和 detail 状态 (非持久数据).
function persistentBundle(bundle: SourceBundle): SourceBundle {
  return {
    ...bundle,
    // Destructure to drop the `episodes` field from every SourceResult before persisting.
    // 在持久化前通过解构从每个 SourceResult 中删除 `episodes` 字段.
    sources: bundle.sources.map(({ episodes: _episodes, ...source }) => source),
    details: {},
  };
}

// trimBundles filters out expired bundles and keeps only the maxBundles most-recent by updatedAt.
// trimBundles 过滤过期 bundle 并只保留 updatedAt 最新的 maxBundles 条.
function trimBundles(bundles: SourceBundle[]): SourceBundle[] {
  const cutoff = Date.now() - maxBundleAgeMs;
  return bundles
    .filter((bundle) => typeof bundle.updatedAt === "number" && bundle.updatedAt >= cutoff)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, maxBundles);
}

// sameBundle returns true if two bundles represent the same media (by mediaID or overlapping sources).
// sameBundle 如果两个 bundle 代表相同媒体 (通过 mediaID 或重叠 source) 则返回 true.
function sameBundle(left: SourceBundle, right: SourceBundle): boolean {
  if (mediaID(left) === mediaID(right)) {
    return true;
  }

  // Also deduplicate when any source key overlaps, even if the media title differs.
  // 即使媒体标题不同, 只要有任意 source key 重叠也去重.
  const rightIDs = new Set(right.sources.map(sourceID));
  return left.sources.some((source) => rightIDs.has(sourceID(source)));
}

// isStore validates that the parsed JSON matches the expected SourceBundleStore envelope.
// isStore 验证解析后的 JSON 是否匹配预期的 SourceBundleStore 结构.
function isStore(value: unknown): value is SourceBundleStore {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === storageVersion &&
    "bundles" in value &&
    Array.isArray(value.bundles)
  );
}

// sanitizeBundle coerces a raw unknown value into a SourceBundle or returns null on failure.
// sanitizeBundle 将原始 unknown 值强制转换为 SourceBundle, 失败时返回 null.
function sanitizeBundle(value: unknown, options: SanitizeOptions): SourceBundle | null {
  if (!isRecord(value) || typeof value.title !== "string" || !Array.isArray(value.sources)) {
    return null;
  }

  const sources = value.sources.map((source) => sanitizeSourceResult(source, options)).filter((source) => source !== null);
  if (sources.length === 0) {
    return null;
  }

  const updatedAt = typeof value.updatedAt === "number" ? value.updatedAt : 0;
  return {
    version: storageVersion,
    title: value.title,
    type: optionalString(value.type),
    year: optionalString(value.year),
    cover: optionalString(value.cover),
    desc: optionalString(value.desc),
    rate: optionalString(value.rate),
    sources,
    details: options.keepEpisodeData ? sanitizeDetails(value.details) : {},
    updatedAt,
  };
}

// sanitizeDetails iterates the details record and drops any entry that fails validation.
// sanitizeDetails 遍历 details record, 丢弃任何验证失败的条目.
function sanitizeDetails(value: unknown): Record<string, SourceBundleDetail> {
  if (!isRecord(value)) {
    return {};
  }

  const details: Record<string, SourceBundleDetail> = {};
  for (const [id, detail] of Object.entries(value)) {
    const sanitized = sanitizeDetail(id, detail);
    if (sanitized) {
      details[id] = sanitized;
    }
  }
  return details;
}

// sanitizeDetail validates and coerces a single detail entry from raw storage.
// sanitizeDetail 验证并强制转换存储中的单个 detail 条目.
function sanitizeDetail(id: string, value: unknown): SourceBundleDetail | null {
  if (!isRecord(value)) {
    return null;
  }
  const identity = detailIdentity(id, value);
  if (!identity) {
    return null;
  }
  const updatedAt = typeof value.updatedAt === "number" ? value.updatedAt : 0;

  if (value.status === "ready") {
    const detail = sanitizeDetailResponse(value.detail);
    return detail ? { status: "ready", ...identity, updatedAt, detail } : null;
  }
  if (value.status === "failed") {
    return typeof value.error === "string"
      ? { status: "failed", ...identity, updatedAt, error: value.error }
      : { status: "failed", ...identity, updatedAt };
  }
  if (value.status === "idle") {
    const detail = sanitizeDetailResponse(value.detail);
    return detail ? { status: "idle", ...identity, updatedAt, detail } : { status: "idle", ...identity, updatedAt };
  }

  return null;
}

// detailIdentity extracts the sourceKey + videoId from a stored detail entry.
// Prefers explicit string fields; falls back to parsing the JSON-encoded composite key.
// detailIdentity 从存储的 detail 条目中提取 sourceKey + videoId.
// 优先使用显式字符串字段; 回退到解析 JSON 编码的复合键.
function detailIdentity(id: string, value: StoredRecord): Pick<SourceBundleDetail, "sourceKey" | "videoId"> | null {
  if (typeof value.sourceKey === "string" && typeof value.videoId === "string") {
    return { sourceKey: value.sourceKey, videoId: value.videoId };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(id);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" || typeof parsed[1] !== "string") {
    return null;
  }
  return { sourceKey: parsed[0], videoId: parsed[1] };
}

// sanitizeDetailResponse validates and coerces a stored DetailResponse value.
// sanitizeDetailResponse 验证并强制转换存储的 DetailResponse 值.
function sanitizeDetailResponse(value: unknown): DetailResponse | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string") {
    return null;
  }
  if (!Array.isArray(value.episodes) || !value.episodes.every((group) => Array.isArray(group) && group.every(isEpisode))) {
    return null;
  }

  const detail: DetailResponse = {
    id: value.id,
    title: value.title,
    episodes: value.episodes,
  };
  copyOptionalDetailString(value, detail, "type");
  copyOptionalDetailString(value, detail, "year");
  copyOptionalDetailString(value, detail, "cover");
  copyOptionalDetailString(value, detail, "desc");
  copyOptionalDetailString(value, detail, "director");
  copyOptionalDetailString(value, detail, "actor");
  copyOptionalDetailString(value, detail, "area");
  return detail;
}

// isEpisode checks that a value has the string name and url fields required by the Episode type.
// isEpisode 检查值是否具有 Episode 类型要求的 name 和 url 字符串字段.
function isEpisode(value: unknown): boolean {
  return isRecord(value) && typeof value.name === "string" && typeof value.url === "string";
}

// copyOptionalDetailString copies a string field from source to target only if it is a string.
// Non-string values (null, number, array, etc.) are silently dropped.
// copyOptionalDetailString 仅当字段为字符串时才将其从 source 复制到 target.
// 非字符串值 (null、number、array 等) 静默丢弃.
function copyOptionalDetailString(source: StoredRecord, target: DetailResponse, key: DetailOptionalStringKey): void {
  if (typeof source[key] === "string") {
    target[key] = source[key];
  }
}

// sanitizeSourceResult validates and coerces a single SourceResult from raw storage.
// sanitizeSourceResult 验证并强制转换存储中的单个 SourceResult.
function sanitizeSourceResult(value: unknown, options: SanitizeOptions): SourceResult | null {
  if (
    !isRecord(value) ||
    typeof value.source_key !== "string" ||
    typeof value.source_name !== "string" ||
    typeof value.video_id !== "string"
  ) {
    return null;
  }

  const source: SourceResult = {
    source_key: value.source_key,
    source_name: value.source_name,
    video_id: value.video_id,
  };
  if (typeof value.duration_ms === "number") {
    source.duration_ms = value.duration_ms;
  }
  if (options.keepEpisodeData && Array.isArray(value.episodes)) {
    const episodes = value.episodes.filter(isEpisode);
    if (episodes.length > 0) {
      source.episodes = episodes;
    }
  }
  return source;
}

// optionalString returns the value if it is a string, otherwise undefined.
// optionalString 若值为字符串则返回该值, 否则返回 undefined.
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// isRecord is a narrowing helper that confirms an unknown value is a non-null object.
// isRecord 是一个类型收窄辅助函数, 确认 unknown 值为非 null 对象.
function isRecord(value: unknown): value is StoredRecord {
  return typeof value === "object" && value !== null;
}
