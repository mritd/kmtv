/**
 * searchStore — SSE-backed search lifecycle store that survives route unmounts.
 * searchStore — 支持 SSE 的搜索生命周期 store, 在路由卸载时保持搜索状态.
 *
 * Responsibilities / 职责:
 *   - Own the AbortController for the active SSE stream — 持有活动 SSE 流的 AbortController
 *   - Accept progress events and results from the SSE stream — 接收 SSE 流的进度事件和搜索结果
 *   - Guard against stale callbacks from superseded requests via controller identity check — 通过 controller 身份校验防止旧请求的回调污染状态
 *   - Provide setScrollY so the search page restores scroll position on back-navigation — 提供 setScrollY 让搜索页在回退时恢复滚动位置
 *   - Expose cancel() with reason branching: user/supersede/auth return to idle; completed/failed are terminal — 暴露带原因分支的 cancel(): user/supersede/auth 回到 idle; completed/failed 为终态
 *
 * State shape / 状态结构:
 *   queryText           — text field value (unsubmitted)
 *   lastSubmittedQuery  — last query sent to the backend
 *   status              — SearchStatus ("idle" | "loading" | "success" | "error")
 *   results             — SearchResult[] from the SSE stream
 *   progressMap         — phase-keyed SearchProgress events
 *   errorMessage        — error detail for the error state banner
 *   scrollY             — saved scroll offset for back-navigation restoration
 *   activeController    — current SSE AbortController (null when idle)
 *
 * Actions / 动作:
 *   setQueryText(value)                   — update unsubmitted input
 *   setScrollY(value)                     — save scroll offset
 *   submitQuery(query)                    — abort previous + transition to loading
 *   retryQuery()                          — re-submit lastSubmittedQuery
 *   applyProgressEvent(progress, ctrl?)   — merge one phase event (stale-safe)
 *   applyResults(results, ctrl?)          — replace result list (stale-safe)
 *   completeStream(ctrl?)                 — transition to success (stale-safe)
 *   failStream(message, ctrl?)            — transition to error (stale-safe)
 *   attachController(controller)          — register the new SSE controller
 *   detachController()                    — clear controller without aborting
 *   cancel(reason)                        — abort + conditionally go to idle
 *   resetAll()                            — abort + wipe all state
 *
 * Callers / 调用方:
 *   viewer/search/SearchPage.tsx          (reads status/results/progressMap; calls submit/retry/cancel/setScrollY)
 *   viewer/search/useSearchStreamSync.ts  (calls attach/detach/apply* actions as SSE events arrive)
 *   test/setup.ts                         (calls resetAll() in beforeEach)
 */

import { createStore } from "zustand/vanilla";
import { subscribeWithSelector } from "zustand/middleware";

import type { SearchProgress, SearchResult } from "@/api/types";

/**
 * SearchStatus — lifecycle phase of the current search request.
 * SearchStatus — 当前搜索请求的生命周期阶段.
 */
export type SearchStatus = "idle" | "loading" | "success" | "error";

/**
 * SearchProgressMap — phase-keyed map of in-flight progress events from the SSE stream.
 * SearchProgressMap — SSE 流中以阶段为键的进行中进度事件映射.
 *
 * Keys are the `phase` values emitted by the backend: "searching" and "probing".
 * Entries are absent (not null) when no event for that phase has arrived yet.
 * key 为后端推送的 phase 值: "searching" 和 "probing".
 * 尚未收到对应 phase 事件时条目不存在 (非 null).
 */
export type SearchProgressMap = Partial<Record<"searching" | "probing", SearchProgress>>;

/**
 * SearchCancelReason — reason passed to cancel() to drive state branching.
 * SearchCancelReason — 传给 cancel() 以驱动状态分支的取消原因.
 *
 * - "user"      — user explicitly cancelled; return to idle
 * - "supersede" — a new submitQuery replaces the current one; handled internally by submitQuery
 * - "auth"      — logout/user-switch; return to idle
 * - "completed" — stream finished normally; state already handled by completeStream
 * - "failed"    — stream failed; state already handled by failStream
 *
 * - "user"      — 用户主动取消; 回到 idle
 * - "supersede" — 新的 submitQuery 替换当前查询; 由 submitQuery 内部处理
 * - "auth"      — 登出/用户切换; 回到 idle
 * - "completed" — 流正常结束; 状态已由 completeStream 处理
 * - "failed"    — 流失败; 状态已由 failStream 处理
 */
export type SearchCancelReason = "user" | "supersede" | "auth" | "completed" | "failed";

/**
 * SearchStoreState — full state + action contract of searchStore.
 * SearchStoreState — searchStore 的完整状态与 action 接口.
 */
export interface SearchStoreState {
  queryText: string;
  lastSubmittedQuery: string;
  status: SearchStatus;
  results: SearchResult[];
  progressMap: SearchProgressMap;
  errorMessage: string;
  scrollY: number;
  // activeController is a non-serializable runtime slot owning the SSE AbortController.
  // activeController 是非序列化的 SSE 控制器槽位.
  activeController: AbortController | null;

  setQueryText(value: string): void;
  setScrollY(value: number): void;
  submitQuery(query: string): void;
  // retryQuery re-runs the last submitted query, used by the "Retry" button after a stream error.
  // retryQuery 重跑上次提交的查询, 供错误态的"重试"按钮使用.
  retryQuery(): void;
  // SSE-mutating actions accept the originating controller so the store can ignore stale callbacks from aborted requests.
  // SSE 变更方法接收发起的 controller, store 据此忽略已被取消请求的回调.
  applyProgressEvent(progress: SearchProgress, controller?: AbortController): void;
  applyResults(results: SearchResult[], controller?: AbortController): void;
  completeStream(controller?: AbortController): void;
  failStream(message: string, controller?: AbortController): void;
  attachController(controller: AbortController): void;
  detachController(): void;
  cancel(reason: SearchCancelReason): void;
  resetAll(): void;
}

// initialState is extracted so resetAll() can spread it atomically instead of listing each field.
// 提取 initialState 以便 resetAll() 原子地展开, 而不是逐字段列举.
const initialState: Pick<
  SearchStoreState,
  | "queryText"
  | "lastSubmittedQuery"
  | "status"
  | "results"
  | "progressMap"
  | "errorMessage"
  | "scrollY"
  | "activeController"
> = {
  queryText: "",
  lastSubmittedQuery: "",
  status: "idle",
  results: [],
  progressMap: {},
  errorMessage: "",
  scrollY: 0,
  activeController: null,
};

/**
 * searchStore — vanilla Zustand store with selector subscriptions.
 * searchStore — 支持 selector 订阅的原生 Zustand store.
 *
 * subscribeWithSelector is required so useSearchStreamSync.ts can subscribe to individual state
 * slices (e.g. the activeController slot) using the vanilla selector form
 * `store.subscribe(selector, listener)` without coupling every listener to unrelated changes.
 * subscribeWithSelector 让 useSearchStreamSync.ts 可以使用 vanilla selector 形式
 * `store.subscribe(selector, listener)` 订阅单个状态切片 (如 activeController 槽位), 避免不相关变更触发所有监听器.
 *
 * searchStore owns the SSE lifecycle so route unmount does not cancel an in-progress search.
 * searchStore 持有 SSE 生命周期, 路由卸载不会取消进行中的搜索.
 */
export const searchStore = createStore<SearchStoreState>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    setQueryText: (value) => set({ queryText: value }),

    setScrollY: (value) => set({ scrollY: value }),

    submitQuery: (query) => {
      // Abort the old controller in place;
      // do NOT call cancel() because that would publish an intermediate state with the old query still set.
      // 直接 abort 旧控制器, 不走 cancel(), 避免发布旧 query 的中间状态.
      const previous = get().activeController;
      if (previous) previous.abort();
      set({
        lastSubmittedQuery: query,
        status: "loading",
        results: [],
        progressMap: {},
        errorMessage: "",
        activeController: null,
      });
    },

    retryQuery: () => {
      // Retry re-submits the last query even if it has not changed, by going through submitQuery so the same atomic transition runs.
      // 重试用最后一次 query 再次走 submitQuery, 复用原子状态转换.
      const query = get().lastSubmittedQuery;
      if (query) get().submitQuery(query);
    },

    applyProgressEvent: (progress, controller) => {
      // Stale-safety: ignore events from a superseded controller.
      // 陈旧防护: 忽略已被取代 controller 的事件.
      if (controller && controller !== get().activeController) return;
      // Only the two phases the backend produces are accepted; unknown phases are silently dropped.
      // 仅接受后端产生的两个 phase; 未知 phase 静默丢弃.
      if (progress.phase !== "searching" && progress.phase !== "probing") return;
      set((s) => ({ progressMap: { ...s.progressMap, [progress.phase]: progress } }));
    },

    applyResults: (results, controller) => {
      // Stale-safety: ignore results from a superseded controller.
      // 陈旧防护: 忽略已被取代 controller 的结果.
      if (controller && controller !== get().activeController) return;
      set({ results });
    },

    completeStream: (controller) => {
      // Stale-safety: ignore completion from a superseded controller.
      // 陈旧防护: 忽略已被取代 controller 的完成信号.
      if (controller && controller !== get().activeController) return;
      set({ status: "success", activeController: null });
    },

    failStream: (message, controller) => {
      // Stale-safety: ignore failure from a superseded controller.
      // 陈旧防护: 忽略已被取代 controller 的失败信号.
      if (controller && controller !== get().activeController) return;
      set({ status: "error", errorMessage: message, activeController: null });
    },

    attachController: (controller) => set({ activeController: controller }),

    detachController: () => set({ activeController: null }),

    cancel: (reason) => {
      const controller = get().activeController;
      if (controller) controller.abort();
      // user/supersede/auth move back to idle so the UI can re-engage;
      // completed/failed are terminal markers handled by completeStream/failStream.
      // user/supersede/auth 回到 idle 以便 UI 再次响应; completed/failed 由 completeStream/failStream 处理.
      if (reason === "user" || reason === "supersede" || reason === "auth") {
        set({ status: "idle", activeController: null });
      } else {
        // "completed" / "failed" — only clear the controller slot; status is already set.
        // "completed" / "failed" — 仅清空 controller 槽; 状态已由对应方法设置.
        set({ activeController: null });
      }
    },

    resetAll: () => {
      // Abort any in-flight SSE before clearing state so the fetch is actually torn down, not leaked.
      // 清空状态前先中止进行中的 SSE, 防止泄漏.
      const controller = get().activeController;
      if (controller) controller.abort();
      set({ ...initialState });
    },
  })),
);
