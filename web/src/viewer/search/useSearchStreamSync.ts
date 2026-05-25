/**
 * useSearchStreamSync — React bridge hook that drives the SSE search stream from searchStore state.
 * useSearchStreamSync — React 桥接 hook, 从 searchStore 状态驱动 SSE 搜索流.
 *
 * Responsibilities / 职责:
 *   - Subscribe to searchStore changes and launch a new SSE stream whenever status="loading" with no activeController — 订阅 searchStore 变化, 在 status="loading" 且无 activeController 时启动新 SSE 流
 *   - Attach an AbortController to the store before fetching; tear it down on completion/error/abort — 获取前向 store 注册 AbortController; 完成/错误/中止时清除
 *   - Forward SSE events to the store's apply* actions (progress, results, error) — 将 SSE 事件转发到 store 的 apply* action
 *   - Ignore stale callbacks from superseded controllers via two-guard pattern — 通过双重守卫忽略已被替换 controller 的回调
 *   - Resume an orphaned in-flight stream on initial mount (e.g. after route re-mount) — 初始挂载时恢复孤儿进行中流 (如路由重挂后)
 *
 * Guard pattern / 守卫模式:
 *   Two guards protect against stale events:
 *   两重守卫防止陈旧事件:
 *   1. `controller.signal.aborted` — fast-path: abort already called — 快速路径: abort 已被调用
 *   2. `searchStore.getState().activeController !== controller` — store replaced the controller — store 已替换 controller
 *   Both guards run before any store mutation so no race between abort + new stream start.
 *   两个守卫在任何 store 变更前运行, 防止 abort + 新流启动之间的竞争.
 *
 * Design / 设计:
 *   The hook is stateless from React's perspective — all state lives in the Zustand vanilla store.
 *   This means route unmount does NOT cancel the stream; the search continues and the store
 *   retains progress + results until the user navigates back or starts a new search.
 *   从 React 角度看 hook 是无状态的 — 所有状态存在于 Zustand vanilla store.
 *   这意味着路由卸载不会取消流; 搜索继续进行, store 保留进度 + 结果直到用户返回或发起新搜索.
 *
 * Callers / 调用方:
 *   viewer/search/SearchPage.tsx (sole caller; called with the APIClient from context)
 */

import { useEffect } from "react";

import type { APIClient } from "@/api/client";
import { searchStore } from "@/store/searchStore";

/**
 * useSearchStreamSync — mounts a store subscription that starts an SSE stream on demand.
 * useSearchStreamSync — 挂载 store 订阅, 按需启动 SSE 流.
 *
 * Called once by SearchPage; `api` should be stable (from useAPI context) to avoid re-subscribing.
 * 由 SearchPage 调用一次; `api` 应保持稳定 (来自 useAPI context) 以避免重新订阅.
 *
 * @param api — APIClient instance from useAPI() context — 来自 useAPI() context 的 APIClient 实例
 */
export function useSearchStreamSync(api: APIClient): void {
  useEffect(() => {
    // Subscribe first, then call maybeStart() for the case where the store is already
    // in "loading" state when this hook mounts (e.g. route remount mid-search).
    // 先订阅, 再调用 maybeStart() 以处理 hook 挂载时 store 已在 "loading" 状态的情况
    // (如搜索中途路由重挂).
    const unsub = searchStore.subscribe(() => {
      maybeStart();
    });
    maybeStart();
    return () => {
      unsub();
    };

    function maybeStart() {
      const s = searchStore.getState();
      // Only start a new stream when the store is in "loading" with no active controller.
      // Other statuses (success, error, idle) do not need a stream.
      // 仅在 store 处于 "loading" 且无活动 controller 时启动新流.
      // 其他状态 (success, error, idle) 不需要流.
      if (s.status !== "loading") return;
      if (s.activeController) return;
      if (!s.lastSubmittedQuery) return;

      const controller = new AbortController();
      // Register the controller before the async operation so the store can abort it
      // if a new submitQuery arrives between now and when the fetch starts.
      // 在异步操作前注册 controller, 以便在此时到 fetch 启动之间新的 submitQuery 到来时 store 可以中止它.
      s.attachController(controller);

      void api
        .searchStream(
          s.lastSubmittedQuery,
          (event) => {
            // Guard 1: abort already called — skip all mutations.
            // 守卫 1: abort 已被调用 — 跳过所有变更.
            if (controller.signal.aborted) return;
            // Guard 2: a newer controller has been attached — this callback is stale.
            // 守卫 2: 已有新 controller 被注册 — 此回调已过期.
            if (searchStore.getState().activeController !== controller) return;
            const store = searchStore.getState();
            if (event.type === "progress") {
              store.applyProgressEvent(event.progress, controller);
            } else if (event.type === "result") {
              // Normalise missing/null results array to empty to avoid downstream null-checks.
              // 将缺失/null 的 results 数组规范化为空, 避免下游 null 检查.
              const results = Array.isArray(event.response.results) ? event.response.results : [];
              store.applyResults(results, controller);
            } else {
              // "error" event type from the SSE stream — propagate the message to the store.
              // SSE 流的 "error" 事件类型 — 将消息传播到 store.
              store.failStream(event.message, controller);
            }
          },
          { signal: controller.signal },
        )
        .then(() => {
          // Same two-guard pattern for the completion path.
          // 完成路径使用相同的双重守卫模式.
          if (controller.signal.aborted) return;
          if (searchStore.getState().activeController !== controller) return;
          searchStore.getState().completeStream(controller);
        })
        .catch((err) => {
          // Aborted fetches throw DOMException "AbortError" — guard 1 silences those.
          // 被中止的 fetch 抛出 DOMException "AbortError" — 守卫 1 静默这些错误.
          if (controller.signal.aborted) return;
          if (searchStore.getState().activeController !== controller) return;
          const message = err instanceof Error ? err.message : "stream error";
          searchStore.getState().failStream(message, controller);
        });
    }
  }, [api]);
}
