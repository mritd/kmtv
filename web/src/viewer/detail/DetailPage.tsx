/**
 * viewer/detail/DetailPage.tsx — multi-source video detail page with background source loading.
 * viewer/detail/DetailPage.tsx — 带后台多来源加载的视频详情页.
 *
 * Responsibilities / 职责:
 *   - Resolve the initial SourceBundle from navigation state → localStorage → single-source fallback
 *     — 从导航 state → localStorage → 单来源兜底依次解析初始 SourceBundle
 *   - Fetch the selected source's detail via React Query (useDetailQuery) — 通过 React Query 获取所选来源的 detail
 *   - Background-fetch detail for all other sources in the bundle — 后台获取 bundle 中所有其他来源的 detail
 *   - Run a recovery search when opened from a shared URL with no bundle context — 从共享 URL 打开且无 bundle 上下文时执行恢复搜索
 *   - Mirror playback state into detailStore so navigating away and back restores the URL
 *     — 将播放状态同步到 detailStore, 使离开后返回仍可恢复 URL
 *   - Auto-select the first playable episode; restore the last-watched episode from playbackProgress
 *     — 自动选择首个可播放集数; 从 playbackProgress 恢复上次观看集数
 *   - Preserve the user's episode index when switching sources — 切换来源时保持用户的集数索引
 *   - Persist bundle updates to localStorage (saveSourceBundle) after every detail mutation
 *     — 每次 detail 变更后将 bundle 更新持久化到 localStorage
 *
 * Key exports / 主要导出:
 *   DetailPage
 *
 * Callers / 调用方:
 *   app/AppRoutes.tsx — mounted at /detail/:token
 *
 * Route token / 路由令牌:
 *   The :token path parameter is an opaque base64url encoding of (source_key, video_id)
 *   (see storage/detailRoute.ts, ADR-015). DetailPage decodes it on every render and
 *   shows a "link no longer available" status when the token is malformed.
 *   :token 路径参数是 (source_key, video_id) 的 base64url 不透明编码
 *   (详见 storage/detailRoute.ts, ADR-015). DetailPage 在每次渲染时解码,
 *   token 非法时展示 "link no longer available" 状态.
 *
 * React Query key: ["detail", sourceKey, videoId] — Tier 4 locked via useDetailQuery (viewerHooks.ts)
 * localStorage key: "kmtv.sourceBundles.v1" — Tier 4 locked (sourceBundles.ts)
 * detailStore: LRU_CAP = 8 entries; see store/detailStore.ts for eviction semantics.
 *
 * Tier 4 锁定说明:
 *   - React Query key 不得更改 (viewerHooks.ts 中的 useDetailQuery)
 *   - localStorage key "kmtv.sourceBundles.v1" 不得更改
 *   - 路由路径 /detail/:token 不得更改 (token 编码方案 ADR-015)
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useParams } from "react-router-dom";

import type { DetailResponse, Episode, SearchResult, SourceResult } from "@/api/types";
import { useAPI } from "@/api/context";
import { useDetailQuery } from "@/api/viewerHooks";
import { StatusState } from "@/shared/ui/StatusState";
import { decodeDetailToken } from "@/storage/detailRoute";
import {
  type SourceBundle,
  bundleFromSearchResult,
  markSourceBundleDetailFailed,
  restoreSourceBundle,
  saveSourceBundle,
  sanitizeSourceBundle,
  sourceID,
  sourceKeyID,
  upsertSourceBundleDetail,
} from "@/storage/sourceBundles";
import {
  getPlaybackProgress,
  setPlaybackPosition,
  setPlaybackSelection,
} from "@/storage/playbackProgress";
import { detailEntryKey, detailStore } from "@/store/detailStore";

import { DetailSkeleton } from "@/viewer/skeletons/DetailSkeleton";

import { PlaybackPanel } from "../playback/PlaybackPanel";
import { createInitialPlaybackState, playbackReducer, type PlaybackAction } from "../playback/playbackState";
import { EpisodePicker } from "./EpisodePicker";
import type { SourcePickerItem } from "./SourcePicker";
import { SourcePicker } from "./SourcePicker";

/**
 * DetailPage is the primary video detail + playback page.
 * DetailPage 是主要的视频详情与播放页.
 *
 * Route param: token — opaque base64url encoding of (source_key, video_id),
 * produced by storage/detailRoute.encodeDetailToken. Malformed tokens render
 * a "link no longer available" status with a search fallback link.
 * 路由参数: token — (source_key, video_id) 的 base64url 不透明编码,
 * 由 storage/detailRoute.encodeDetailToken 生成. token 非法时渲染
 * "link no longer available" 状态并提供搜索兜底链接.
 *
 * Navigation state: { sourceBundle: SourceBundle } — passed by search/home when navigating to detail.
 * When present the bundle is trusted as already-resolved (hasResolvedBundle: true).
 * 导航 state: { sourceBundle: SourceBundle } — 由搜索/主页导航到详情时传递.
 * 存在时视为已解析 (hasResolvedBundle: true).
 */
export function DetailPage() {
  const { token = "" } = useParams();
  const decoded = decodeDetailToken(token);
  if (!decoded) {
    return <InvalidDetailTokenState />;
  }
  return <DetailPageContent sourceKey={decoded.sourceKey} videoId={decoded.videoId} />;
}

/**
 * InvalidDetailTokenState renders when the URL token cannot be decoded.
 * InvalidDetailTokenState 在 URL token 解码失败时渲染.
 */
function InvalidDetailTokenState() {
  const { t } = useTranslation("viewer");
  return (
    <main className="page detail-page">
      <StatusState title={t("detail.loadFailed")} description={t("detail.loadFailedHelp")} tone="error" />
      <p className="muted detail-invalid-token-hint">
        <Link to="/search">{t("detail.backToSearch")}</Link>
      </p>
    </main>
  );
}

interface DetailPageContentProps {
  sourceKey: string;
  videoId: string;
}

/**
 * DetailPageContent is the real detail-page body, mounted only when the route token decodes successfully.
 * Splitting this from DetailPage keeps every hook call below an unconditional return — required by React.
 * DetailPageContent 是详情页的真实主体, 仅在路由 token 成功解码时挂载.
 * 与 DetailPage 拆分确保下方的 hook 调用都位于无条件 return 之后 — React 规则要求.
 */
function DetailPageContent({ sourceKey: source, videoId: id }: DetailPageContentProps) {
  const location = useLocation();
  const api = useAPI();
  const { t } = useTranslation("viewer");
  const currentRouteID = sourceKeyID(source, id);
  const [bundleState, setBundleState] = useState(() => initialBundleState(source, id, location.state));
  const [selectedSourceID, setSelectedSourceID] = useState(currentRouteID);
  const playbackSequence = useRef(0);
  const backgroundLoadingIDs = useRef(new Set<string>());
  const backgroundGeneration = useRef(0);
  const recoveryAttemptedRoute = useRef<string | null>(null);
  const recoveryGeneration = useRef(0);
  const pendingEpisodeSelection = useRef<{ sourceKey: string; videoID: string; episodeIndex: number } | null>(null);
  const currentRouteIDRef = useRef(currentRouteID);
  currentRouteIDRef.current = currentRouteID;
  const bundle = bundleState.bundle;
  const hasResolvedBundle = bundleState.hasResolvedBundle;
  const setBundle = (updater: SourceBundle | ((current: SourceBundle) => SourceBundle)) => {
    setBundleState((current) => ({
      ...current,
      bundle: typeof updater === "function" ? updater(current.bundle) : updater,
    }));
  };
  const currentSource = selectedSource(bundle, selectedSourceID) ?? bundle.sources[0] ?? singleSource(source, id);
  const currentSourceID = sourceID(currentSource);
  const currentSourceKey = currentSource.source_key;
  const currentVideoID = currentSource.video_id;
  const detail = useDetailQuery(currentSourceKey, currentVideoID);
  // Seed playback state from detailStore so navigating away and back preserves the resolved URL.
  // 从 detailStore 注入播放状态, 跨导航保留已解析 URL.
  const [state, baseDispatch] = useReducer(playbackReducer, undefined, () => {
    const key = detailEntryKey(source, id);
    return detailStore.getState().entries[key]?.playback ?? createInitialPlaybackState();
  });
  // Mirror every dispatch into detailStore so future remounts can hydrate.
  // 把每次 dispatch 同步到 detailStore, 供未来重挂使用.
  const dispatch = useCallback(
    (action: PlaybackAction) => {
      baseDispatch(action);
      const key = detailStore.getState().ensureEntry(source, id);
      detailStore.getState().dispatchPlayback(key, action);
    },
    [source, id],
  );
  const currentDetail = bundle.details[sourceKeyID(currentSourceKey, currentVideoID)]?.detail ?? detail.data;
  const groups = currentDetail?.episodes ?? (currentSource.episodes?.length ? [currentSource.episodes] : []);
  const episodes = groups[state.groupIndex] ?? [];
  const canRenderRecoverableDetailError = detail.isError && bundle.sources.length > 1;
  const displayDetail = currentDetail ?? fallbackDetail(bundle, currentSource);
  const backgroundSourceSignature = bundle.sources
    .filter((source) => sourceID(source) !== currentSourceID)
    .filter((source) => {
      const status = bundle.details[sourceKeyID(source.source_key, source.video_id)]?.status;
      return status !== "ready" && status !== "failed";
    })
    .map((source) => sourceKeyID(source.source_key, source.video_id))
    .join("|");

  // Track previous deps so Strict Mode's double effect invoke does not wipe the hydrated state.
  // 记录上一次依赖, 避免 Strict Mode 二次执行清空已 hydrate 的状态.
  const previousDepsRef = useRef<{ source: string; id: string; locationState: unknown } | null>(null);
  useEffect(() => {
    const previous = previousDepsRef.current;
    previousDepsRef.current = { source, id, locationState: location.state };
    if (previous === null) {
      // Initial effect run after mount:
      // lazy initializers already seeded state (possibly from detailStore cache).
      // 首次副作用执行: 上方懒初始化器已填好状态.
      return;
    }
    if (previous.source === source && previous.id === id && previous.locationState === location.state) {
      // Strict Mode double-invoke with no actual dep change: do not reset.
      // Strict Mode
      // 二次执行且依赖未变: 不重置.
      return;
    }
    setBundleState(initialBundleState(source, id, location.state));
    setSelectedSourceID(sourceKeyID(source, id));
    playbackSequence.current += 1;
    backgroundGeneration.current += 1;
    recoveryGeneration.current += 1;
    recoveryAttemptedRoute.current = null;
    pendingEpisodeSelection.current = null;
    backgroundLoadingIDs.current.clear();
    dispatch({ type: "reset" });
  }, [source, id, location.state, dispatch]);

  useEffect(() => {
    if (!detail.data) {
      return;
    }
    setBundle((current) => {
      const next = upsertSourceBundleDetail(current, currentSourceKey, currentVideoID, detail.data);
      saveSourceBundle(next);
      return next;
    });
  }, [currentSourceKey, currentVideoID, detail.data]);

  useEffect(() => {
    if (!detail.isError) {
      return;
    }
    setBundle((current) => {
      if (current.details[sourceKeyID(currentSourceKey, currentVideoID)]?.status === "ready") {
        return current;
      }
      const next = markSourceBundleDetailFailed(current, currentSourceKey, currentVideoID, "Detail request failed.");
      saveSourceBundle(next);
      return next;
    });
  }, [currentSourceKey, currentVideoID, detail.isError]);

  useEffect(() => {
    if (hasResolvedBundle || !currentDetail?.title || recoveryAttemptedRoute.current === currentRouteID) {
      return;
    }

    const routeID = currentRouteID;
    const sourceKey = currentSourceKey;
    const videoID = currentVideoID;
    const detailForSource = currentDetail;
    const generation = recoveryGeneration.current;
    recoveryAttemptedRoute.current = routeID;
    void api
      .search(detailForSource.title)
      .then((response) => {
        if (currentRouteIDRef.current !== routeID || recoveryGeneration.current !== generation) {
          return;
        }
        const match = response.results.find((result) => matchesDetail(result, detailForSource));
        if (!match) {
          setBundleState((current) => {
            if (currentRouteIDRef.current !== routeID || recoveryGeneration.current !== generation) {
              return current;
            }
            return { ...current, hasResolvedBundle: true };
          });
          return;
        }
        const recovered = upsertSourceBundleDetail(bundleWithCurrentSource(bundleFromSearchResult(match), sourceKey, videoID), sourceKey, videoID, detailForSource);
        saveSourceBundle(recovered);
        setBundleState((current) => {
          if (currentRouteIDRef.current !== routeID || recoveryGeneration.current !== generation) {
            return current;
          }
          return { bundle: recovered, hasResolvedBundle: true };
        });
      })
      .catch(() => {
        setBundleState((current) => {
          if (currentRouteIDRef.current !== routeID || recoveryGeneration.current !== generation) {
            return current;
          }
          return { ...current, hasResolvedBundle: true };
        });
      });
  }, [api, currentDetail, currentRouteID, currentSourceKey, currentVideoID, hasResolvedBundle]);

  useEffect(() => {
    if (!backgroundSourceSignature) {
      return;
    }
    const expectedBundleID = bundleSourceIdentity(bundle);
    const generation = backgroundGeneration.current;
    const candidates = bundle.sources.filter((source) => {
      const id = sourceKeyID(source.source_key, source.video_id);
      const status = bundle.details[id]?.status;
      return sourceID(source) !== currentSourceID && status !== "ready" && status !== "failed" && !backgroundLoadingIDs.current.has(`${generation}:${id}`);
    });

    for (const candidate of candidates) {
      const id = sourceKeyID(candidate.source_key, candidate.video_id);
      const loadingID = `${generation}:${id}`;
      backgroundLoadingIDs.current.add(loadingID);
      void api
        .detail(candidate.source_key, candidate.video_id)
        .then((nextDetail) => {
          setBundle((current) => {
            if (backgroundGeneration.current !== generation) {
              return current;
            }
            if (bundleSourceIdentity(current) !== expectedBundleID || !bundleContainsSource(current, candidate)) {
              return current;
            }
            const currentStatus = current.details[id]?.status;
            if (currentStatus === "ready" || currentStatus === "failed") {
              return current;
            }
            const next = upsertSourceBundleDetail(current, candidate.source_key, candidate.video_id, nextDetail);
            saveSourceBundle(next);
            return next;
          });
        })
        .catch(() => {
          setBundle((current) => {
            if (backgroundGeneration.current !== generation) {
              return current;
            }
            if (bundleSourceIdentity(current) !== expectedBundleID || !bundleContainsSource(current, candidate)) {
              return current;
            }
            const currentStatus = current.details[id]?.status;
            if (currentStatus === "ready" || currentStatus === "failed") {
              return current;
            }
            const next = markSourceBundleDetailFailed(current, candidate.source_key, candidate.video_id, "Detail request failed.");
            saveSourceBundle(next);
            return next;
          });
        })
        .finally(() => {
          backgroundLoadingIDs.current.delete(loadingID);
        });
    }
  }, [api, backgroundSourceSignature, bundle, currentSourceID]);

  useEffect(() => {
    const pendingSelection = pendingEpisodeSelection.current;
    if (pendingSelection?.sourceKey === currentSourceKey && pendingSelection.videoID === currentVideoID) {
      const detailStatus = bundle.details[sourceKeyID(currentSourceKey, currentVideoID)]?.status;
      if (detailStatus !== "ready") {
        return;
      }
      const pendingGroupIndex = firstPlayableGroup(groups);
      const pendingGroup = groups[pendingGroupIndex] ?? [];
      const pendingEpisodeIndex = pendingSelection.episodeIndex < pendingGroup.length ? pendingSelection.episodeIndex : 0;
      const pendingEpisode = pendingGroup[pendingEpisodeIndex];
      pendingEpisodeSelection.current = null;
      if (pendingEpisode) {
        resolvePlaybackEpisode(pendingGroupIndex, pendingEpisodeIndex, pendingEpisode, currentSourceKey);
      }
      return;
    }
    if (state.status !== "idle" || state.selectedEpisode) {
      return;
    }
    // Restore the last-watched episode for this title when one is recorded;
    // fall back to the first playable episode.
    // 优先恢复该影片上次观看的集数; 没有记录时回退到首集.
    const saved = getPlaybackProgress(currentSourceKey, currentVideoID);
    if (saved) {
      const savedGroup = groups[saved.groupIndex];
      const savedEpisode = savedGroup?.[saved.episodeIndex];
      if (savedEpisode) {
        resolvePlaybackEpisode(saved.groupIndex, saved.episodeIndex, savedEpisode, currentSourceKey);
        return;
      }
    }
    const groupIndex = groups.findIndex((group) => group.length > 0);
    const episode = groups[groupIndex]?.[0];
    if (!episode) {
      return;
    }
    resolvePlaybackEpisode(groupIndex, 0, episode, currentSourceKey);
  }, [bundle.details, currentSourceKey, currentVideoID, groups, state.selectedEpisode, state.status]);

  async function resolvePlaybackEpisode(
    groupIndex: number,
    episodeIndex: number,
    episode: Episode,
    playbackSourceKey = currentSourceKey,
  ) {
    const sequence = playbackSequence.current + 1;
    playbackSequence.current = sequence;
    dispatch({ type: "selectEpisode", groupIndex, episodeIndex, episode });
    // Persist the active episode selection per route so refresh resumes it.
    // 按路由持久化当前集数, 刷新可恢复.
    setPlaybackSelection(currentSourceKey, currentVideoID, groupIndex, episodeIndex);
    try {
      const result = await api.playbackURL(episode.url, playbackSourceKey);
      if (sequence !== playbackSequence.current) {
        return;
      }
      dispatch({ type: "resolveSuccess", url: result.url, mode: result.mode });
    } catch {
      if (sequence !== playbackSequence.current) {
        return;
      }
      dispatch({ type: "resolveFailure", message: "Unable to create playback URL." });
    }
  }

  function resolveEpisode(groupIndex: number, episodeIndex: number, episode: Episode) {
    pendingEpisodeSelection.current = null;
    void resolvePlaybackEpisode(groupIndex, episodeIndex, episode, currentSourceKey);
  }

  function selectSourceID(sourceIDValue: string) {
    const nextSource = selectedSource(bundle, sourceIDValue);
    if (!nextSource) {
      return;
    }
    playbackSequence.current += 1;
    const nextGroups = groupsForSource(bundle, nextSource);
    const groupIndex = firstPlayableGroup(nextGroups);
    const group = nextGroups[groupIndex] ?? [];
    const desiredEpisodeIndex = state.episodeIndex;
    const episodeIndex = desiredEpisodeIndex < group.length ? desiredEpisodeIndex : 0;
    const episode = group[episodeIndex];
    const detailStatus = bundle.details[sourceKeyID(nextSource.source_key, nextSource.video_id)]?.status;
    pendingEpisodeSelection.current = !episode || (desiredEpisodeIndex >= group.length && detailStatus !== "ready")
      ? { sourceKey: nextSource.source_key, videoID: nextSource.video_id, episodeIndex: desiredEpisodeIndex }
      : null;
    setSelectedSourceID(sourceID(nextSource));
    dispatch({ type: "selectSource", groupIndex, groups: nextGroups });
    if (episode) {
      void resolvePlaybackEpisode(groupIndex, episodeIndex, episode, nextSource.source_key);
    }
  }

  function retry() {
    if (state.selectedEpisode) {
      pendingEpisodeSelection.current = null;
      void resolvePlaybackEpisode(state.groupIndex, state.episodeIndex, state.selectedEpisode, currentSourceKey);
    }
  }

  if (detail.isLoading && !currentDetail) {
    return (
      <main className="page detail-page" aria-busy="true" aria-label={t("detail.loading")}>
        <DetailSkeleton />
      </main>
    );
  }
  if (detail.isError && !currentDetail && !canRenderRecoverableDetailError) {
    return (
      <main className="page detail-page">
        <StatusState title={t("detail.loadFailed")} description={t("detail.loadFailedHelp")} tone="error" />
      </main>
    );
  }
  // NOTE: This branch is currently unreachable in practice.
  // `displayDetail = currentDetail ?? fallbackDetail(...)` and fallbackDetail always returns an object.
  // Kept as a defensive guard in case the data model changes to allow a truly absent detail.
  // 注: 此分支在实际运行中不可达.
  // displayDetail = currentDetail ?? fallbackDetail(...), 而 fallbackDetail 始终返回对象.
  // 保留此处作为防御性兜底, 以防数据模型变更导致 detail 真正缺失.
  if (!displayDetail && !canRenderRecoverableDetailError) {
    return (
      <main className="page detail-page">
        <StatusState title={t("detail.emptyTitle")} />
      </main>
    );
  }

  return (
    <main className="page detail-page">
      <section className="detail-player-grid">
        <div className="detail-main">
          <PlaybackPanel
            state={state}
            sourceName={currentSource.source_name}
            onPlaying={() => dispatch({ type: "playing" })}
            onRetry={retry}
            // Resume only when the persisted entry matches the episode currently loaded.
            // 仅当持久化条目与当前播放集匹配时才恢复.
            initialPositionSec={resumePositionFor(currentSourceKey, currentVideoID, state.groupIndex, state.episodeIndex)}
            onPositionChange={(positionSec, durationSec) =>
              setPlaybackPosition(currentSourceKey, currentVideoID, state.groupIndex, state.episodeIndex, positionSec, durationSec)
            }
          />
          <section className="detail-copy">
            <p className="muted">{[displayDetail.type, displayDetail.year, displayDetail.area].filter(Boolean).join(" | ")}</p>
            <h1>{displayDetail.title}</h1>
            {displayDetail.desc ? <p>{displayDetail.desc}</p> : null}
          </section>
        </div>
        <aside className="detail-sidebar">
          <SourcePicker
            sources={sourcePickerItems(bundle, currentSourceID, detail.isLoading)}
            selectedKey={sourceID(currentSource)}
            onSelect={selectSourceID}
          />
          <EpisodePicker
            episodes={episodes}
            selectedIndex={state.episodeIndex}
            onSelect={(episodeIndex, episode) => resolveEpisode(state.groupIndex, episodeIndex, episode)}
          />
          {state.status === "failed" ? (
            <Link className="return-search-link" to="/search">
              {t("detail.backToSearch")}
            </Link>
          ) : null}
        </aside>
      </section>
    </main>
  );
}

// bundleFromLocationState extracts a validated SourceBundle from React Router location.state.
// Returns null when the state is absent, malformed, or fails sanitization.
// bundleFromLocationState 从 React Router location.state 中提取经过验证的 SourceBundle.
// state 缺失、格式错误或未通过净化时返回 null.
function bundleFromLocationState(state: unknown): SourceBundle | null {
  if (typeof state !== "object" || state === null || !("sourceBundle" in state)) {
    return null;
  }
  const sourceBundle = state.sourceBundle;
  return sanitizeSourceBundle(sourceBundle);
}

// initialBundleState resolves the starting bundle for a route in priority order:
//   1. Navigation state bundle (already resolved, e.g. from search page) — fast path
//   2. localStorage stored bundle (from a previous visit to this media) — restored path
//   3. Single-source synthetic bundle from the route params — recovery path
// initialBundleState 按优先级解析路由的初始 bundle:
//   1. 导航 state bundle (已解析, 如来自搜索页) — 快速路径
//   2. localStorage 存储的 bundle (来自上次访问该媒体) — 恢复路径
//   3. 路由参数构造的单来源合成 bundle — 兜底路径
function initialBundleState(sourceKey: string, videoId: string, locationState: unknown) {
  const stateBundle = bundleFromLocationState(locationState);
  if (stateBundle) {
    return { bundle: stateBundle, hasResolvedBundle: true };
  }
  const storedBundle = restoreSourceBundle(sourceKey, videoId);
  if (storedBundle) {
    return { bundle: storedBundle, hasResolvedBundle: true };
  }
  return { bundle: singleSourceBundle(sourceKey, videoId), hasResolvedBundle: false };
}

// singleSourceBundle builds a minimal SourceBundle from route params for the recovery path.
// The title is set to videoId as a placeholder; it will be overwritten once detail loads.
// singleSourceBundle 从路由参数为兜底路径构建最小 SourceBundle.
// title 暂用 videoId; detail 加载后将被覆盖.
function singleSourceBundle(sourceKey: string, videoId: string): SourceBundle {
  return {
    version: 1,
    title: videoId,
    sources: [singleSource(sourceKey, videoId)],
    details: {},
    updatedAt: Date.now(),
  };
}

// singleSource constructs a minimal SourceResult for use in synthetic bundles.
// source_name falls back to the key string so the UI always has something to display.
// singleSource 构造用于合成 bundle 的最小 SourceResult.
// source_name 回退到 key 字符串以确保 UI 始终有内容可显示.
function singleSource(sourceKey: string, videoId: string): SourceResult {
  return { source_key: sourceKey, source_name: sourceKey || "Source", video_id: videoId };
}

// selectedSource finds the SourceResult whose composite sourceID matches the given selectedID.
// Returns null when the ID is not found (e.g. after a bundle reset clears the selection).
// selectedSource 查找 sourceID 与给定 selectedID 匹配的 SourceResult.
// 未找到时返回 null (如 bundle 重置后清空了选择).
function selectedSource(bundle: SourceBundle, selectedID: string): SourceResult | null {
  return bundle.sources.find((source) => sourceID(source) === selectedID) ?? null;
}

// groupsForSource resolves the episode groups for one source from the bundle's detail cache.
// Falls back to inline search-result episodes (wrapped in a group) when detail is not yet ready.
// groupsForSource 从 bundle 的 detail 缓存解析某来源的集数组.
// detail 尚未就绪时回退到内联搜索结果集数 (包装为一组).
function groupsForSource(bundle: SourceBundle, source: SourceResult): Episode[][] {
  const detail = bundle.details[sourceKeyID(source.source_key, source.video_id)]?.detail;
  return detail?.episodes ?? (source.episodes?.length ? [source.episodes] : []);
}

// fallbackDetail synthesizes a DetailResponse from bundle metadata + source episodes.
// Used when the React Query detail fetch has not yet returned for the current source.
// fallbackDetail 从 bundle 元数据和来源集数合成 DetailResponse.
// 用于当前来源的 React Query detail 请求尚未返回时.
function fallbackDetail(bundle: SourceBundle, source: SourceResult): DetailResponse {
  return {
    id: source.video_id,
    title: bundle.title || source.video_id,
    type: bundle.type,
    year: bundle.year,
    cover: bundle.cover,
    desc: bundle.desc,
    episodes: groupsForSource(bundle, source),
  };
}

// firstPlayableGroup returns the index of the first non-empty episode group.
// Returns 0 when no group has episodes so callers can always index without -1 checks.
// firstPlayableGroup 返回首个非空集数组的索引.
// 无组有集数时返回 0, 使调用方可以始终索引而无需 -1 检查.
function firstPlayableGroup(groups: Episode[][]): number {
  const index = groups.findIndex((group) => group.length > 0);
  return index >= 0 ? index : 0;
}

// sourcePickerItems maps the bundle's source list to SourcePickerItem entries for the SourcePicker.
// The current source's status is forced to "loading" while its React Query fetch is in-flight,
// overriding the bundle's stored status which may still show "idle" until the first result arrives.
// sourcePickerItems 将 bundle 的来源列表映射为 SourcePicker 的 SourcePickerItem 条目.
// 当前来源的 React Query 请求进行中时强制其状态为 "loading",
// 覆盖 bundle 中可能仍为 "idle" 的存储状态 (首次结果到达前).
function sourcePickerItems(bundle: SourceBundle, currentSourceID: string, isCurrentLoading: boolean): SourcePickerItem[] {
  return bundle.sources.map((source) => {
    const id = sourceKeyID(source.source_key, source.video_id);
    const detail = bundle.details[id];
    const status = id === currentSourceID && isCurrentLoading ? "loading" : detail?.status ?? "idle";
    return { key: id, name: source.source_name, durationMs: source.duration_ms, status };
  });
}

// bundleSourceIdentity returns a stable string that changes whenever the set of sources in the bundle changes.
// Used by background-fetch effects as a snapshot key to detect stale closures.
// bundleSourceIdentity 返回一个稳定字符串, 当 bundle 中的来源集合变化时该字符串改变.
// 用于后台获取副作用作为快照键以检测陈旧闭包.
function bundleSourceIdentity(bundle: SourceBundle): string {
  return bundle.sources.map((source) => sourceKeyID(source.source_key, source.video_id)).join("|");
}

// bundleContainsSource checks whether the bundle still includes a given source.
// Guards background-fetch callbacks against writing into a bundle that has since been replaced.
// bundleContainsSource 检查 bundle 是否仍包含给定来源.
// 防止后台获取回调将数据写入已被替换的 bundle.
function bundleContainsSource(bundle: SourceBundle, source: SourceResult): boolean {
  const id = sourceKeyID(source.source_key, source.video_id);
  return bundle.sources.some((candidate) => sourceKeyID(candidate.source_key, candidate.video_id) === id);
}

// bundleWithCurrentSource ensures the current route's source appears in the bundle.
// Used during recovery when the search result does not include the route's source_key.
// bundleWithCurrentSource 确保当前路由的来源出现在 bundle 中.
// 用于恢复时搜索结果不含路由 source_key 的情况.
function bundleWithCurrentSource(bundle: SourceBundle, sourceKey: string, videoId: string): SourceBundle {
  if (bundle.sources.some((source) => sourceID(source) === sourceKeyID(sourceKey, videoId))) {
    return bundle;
  }
  return { ...bundle, sources: [singleSource(sourceKey, videoId), ...bundle.sources] };
}

// matchesDetail checks whether a raw search result matches the title/year of the current detail.
// Year matching is fuzzy: either side may be absent (shared URLs often lack year context).
// matchesDetail 检查原始搜索结果是否与当前 detail 的标题/年份匹配.
// 年份匹配为模糊匹配: 任意一侧可以缺失 (共享 URL 通常缺少年份上下文).
function matchesDetail(result: unknown, detail: DetailResponse): result is SearchResult {
  if (!isSearchResult(result)) {
    return false;
  }
  if (result.sources.length === 0 || result.title.trim().toLocaleLowerCase() !== detail.title.trim().toLocaleLowerCase()) {
    return false;
  }
  const resultYear = result.year?.trim();
  const detailYear = detail.year?.trim();
  // When either year is absent we consider it a match — avoids false misses on shared URLs.
  // 任意一侧年份缺失时视为匹配 — 避免共享 URL 的误判.
  return !resultYear || !detailYear || resultYear === detailYear;
}

// isSearchResult is a runtime type guard for recovery search results from third-party-compatible APIs.
// Validates title, sources array, and each source entry before treating the result as matchable.
// isSearchResult 是针对第三方兼容 API 恢复搜索结果的运行时类型保护.
// 在将结果视为可匹配之前验证 title、sources 数组及每个 source 条目.
function isSearchResult(value: unknown): value is SearchResult {
  if (typeof value !== "object" || value === null || !("title" in value) || typeof value.title !== "string" || !("sources" in value)) {
    return false;
  }
  return Array.isArray(value.sources) && value.sources.length > 0 && value.sources.every(isSourceResult);
}

// isSourceResult validates a single SourceResult entry from an untrusted API payload.
// isSourceResult 验证来自不可信 API 负载的单个 SourceResult 条目.
function isSourceResult(value: unknown): value is SourceResult {
  if (
    typeof value === "object" &&
    value !== null &&
    "source_key" in value &&
    typeof value.source_key === "string" &&
    "source_name" in value &&
    typeof value.source_name === "string" &&
    "video_id" in value &&
    typeof value.video_id === "string"
  ) {
    return !("episodes" in value) || value.episodes === undefined || (Array.isArray(value.episodes) && value.episodes.every(isEpisode));
  }
  return false;
}

// isEpisode validates that a value has the shape of an Episode (name + url strings).
// isEpisode 验证值是否具有 Episode (name + url 字符串) 的形状.
function isEpisode(value: unknown): value is Episode {
  return typeof value === "object" && value !== null && "name" in value && typeof value.name === "string" && "url" in value && typeof value.url === "string";
}

/**
 * resumePositionFor returns the persisted playback position only when it belongs to the
 * episode currently being loaded — avoids seeking to an unrelated episode's saved position.
 * resumePositionFor 仅在持久化集数与当前加载集匹配时返回恢复点 — 避免定位到无关集数的保存位置.
 *
 * Returns undefined when sourceKey/videoID are empty (synthetic bundle initial state)
 * or when positionSec is zero (never played, no meaningful resume point).
 * sourceKey/videoID 为空 (合成 bundle 初始状态) 或 positionSec 为零 (从未播放) 时返回 undefined.
 */
function resumePositionFor(sourceKey: string, videoID: string, groupIndex: number, episodeIndex: number): number | undefined {
  // Guard: synthetic bundles have empty sourceKey/videoID — no stored progress to restore.
  // 防护: 合成 bundle 的 sourceKey/videoID 为空 — 没有存储的进度可恢复.
  if (!sourceKey || !videoID) return undefined;
  const saved = getPlaybackProgress(sourceKey, videoID);
  if (!saved) return undefined;
  if (saved.groupIndex !== groupIndex || saved.episodeIndex !== episodeIndex) return undefined;
  return saved.positionSec > 0 ? saved.positionSec : undefined;
}
