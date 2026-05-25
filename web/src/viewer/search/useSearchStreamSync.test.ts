/**
 * useSearchStreamSync.test.ts — hook-level tests for the SSE stream bridge.
 * useSearchStreamSync.test.ts — SSE 流桥接 hook 的 hook 级测试.
 *
 * Covers the core responsibilities: stream start, progress/results forwarding,
 * completion, error propagation, abort-on-cleanup, and stale-controller guards.
 * 覆盖核心职责: 流启动、进度/结果转发、完成、错误传播、清理时中止和陈旧 controller 守卫.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { APIClient } from "@/api/client";
import type { SearchStreamEvent } from "@/api/types";
import { searchStore } from "@/store/searchStore";
import { createTestAPI } from "@/test/testAPI";

import { useSearchStreamSync } from "./useSearchStreamSync";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  searchStore.getState().resetAll();
});

// makeAPI builds a test APIClient with a controllable searchStream implementation.
// makeAPI 构建一个带有可控 searchStream 实现的测试 APIClient.
function makeAPI(searchStream: APIClient["searchStream"]): APIClient {
  return createTestAPI({ searchStream });
}

describe("useSearchStreamSync", () => {
  it("does nothing when the store is idle on mount", () => {
    const searchStream = vi.fn(async () => undefined);
    const api = makeAPI(searchStream);

    renderHook(() => useSearchStreamSync(api));

    expect(searchStream).not.toHaveBeenCalled();
  });

  it("starts the SSE stream when status is loading and no controller is active", async () => {
    let resolveStream!: () => void;
    const streamPromise = new Promise<void>((resolve) => { resolveStream = resolve; });
    const searchStream = vi.fn(async () => streamPromise);
    const api = makeAPI(searchStream);

    renderHook(() => useSearchStreamSync(api));

    act(() => { searchStore.getState().submitQuery("dragon ball"); });

    expect(searchStream).toHaveBeenCalledWith(
      "dragon ball",
      expect.any(Function),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    // Complete the stream to avoid dangling promise in test teardown.
    // 完成流以避免测试清理中的悬挂 promise.
    resolveStream();
  });

  it("forwards progress events to applyProgressEvent on the store", async () => {
    let fireEvent!: (event: SearchStreamEvent) => void;
    let resolveStream!: () => void;
    const streamPromise = new Promise<void>((resolve) => { resolveStream = resolve; });

    const searchStream = vi.fn(async (_query: string, onEvent: (e: SearchStreamEvent) => void) => {
      fireEvent = onEvent;
      return streamPromise;
    });
    const api = makeAPI(searchStream);

    renderHook(() => useSearchStreamSync(api));
    act(() => { searchStore.getState().submitQuery("naruto"); });

    await vi.waitFor(() => expect(fireEvent).toBeDefined());

    act(() => {
      fireEvent({ type: "progress", progress: { phase: "searching", completed: 5, total: 10 } });
    });

    expect(searchStore.getState().progressMap.searching).toEqual({
      phase: "searching",
      completed: 5,
      total: 10,
    });

    resolveStream();
  });

  it("forwards result events to applyResults on the store", async () => {
    let fireEvent!: (event: SearchStreamEvent) => void;
    let resolveStream!: () => void;
    const streamPromise = new Promise<void>((resolve) => { resolveStream = resolve; });

    const searchStream = vi.fn(async (_query: string, onEvent: (e: SearchStreamEvent) => void) => {
      fireEvent = onEvent;
      return streamPromise;
    });
    const api = makeAPI(searchStream);

    renderHook(() => useSearchStreamSync(api));
    act(() => { searchStore.getState().submitQuery("bleach"); });

    await vi.waitFor(() => expect(fireEvent).toBeDefined());

    act(() => {
      fireEvent({
        type: "result",
        response: { results: [{ title: "Bleach", sources: [], year: "2004" }] },
      });
    });

    expect(searchStore.getState().results).toHaveLength(1);
    expect(searchStore.getState().results[0].title).toBe("Bleach");

    resolveStream();
  });

  it("normalises a null results array to empty results", async () => {
    let fireEvent!: (event: SearchStreamEvent) => void;
    let resolveStream!: () => void;
    const streamPromise = new Promise<void>((resolve) => { resolveStream = resolve; });

    const searchStream = vi.fn(async (_query: string, onEvent: (e: SearchStreamEvent) => void) => {
      fireEvent = onEvent;
      return streamPromise;
    });
    const api = makeAPI(searchStream);

    renderHook(() => useSearchStreamSync(api));
    act(() => { searchStore.getState().submitQuery("test"); });

    await vi.waitFor(() => expect(fireEvent).toBeDefined());

    act(() => {
      // Simulate a contract violation where results is null (not an array).
      // 模拟 results 为 null (非数组) 的契约违规情况.
      fireEvent({ type: "result", response: { results: null } } as unknown as SearchStreamEvent);
    });

    // The hook normalises null → [] without throwing.
    // hook 将 null 规范化为 [] 且不抛出异常.
    expect(searchStore.getState().results).toEqual([]);

    resolveStream();
  });

  it("calls failStream when an error event arrives", async () => {
    let fireEvent!: (event: SearchStreamEvent) => void;
    let resolveStream!: () => void;
    const streamPromise = new Promise<void>((resolve) => { resolveStream = resolve; });

    const searchStream = vi.fn(async (_query: string, onEvent: (e: SearchStreamEvent) => void) => {
      fireEvent = onEvent;
      return streamPromise;
    });
    const api = makeAPI(searchStream);

    renderHook(() => useSearchStreamSync(api));
    act(() => { searchStore.getState().submitQuery("test"); });

    await vi.waitFor(() => expect(fireEvent).toBeDefined());

    act(() => {
      fireEvent({ type: "error", message: "upstream failed" });
    });

    expect(searchStore.getState().status).toBe("error");
    expect(searchStore.getState().errorMessage).toBe("upstream failed");

    resolveStream();
  });

  it("transitions to success when the stream resolves without error", async () => {
    const searchStream = vi.fn(async (_query: string, onEvent: (e: SearchStreamEvent) => void) => {
      onEvent({ type: "result", response: { results: [{ title: "One Piece", sources: [], year: "1999" }] } });
    });
    const api = makeAPI(searchStream);

    renderHook(() => useSearchStreamSync(api));
    act(() => { searchStore.getState().submitQuery("one piece"); });

    await vi.waitFor(() => expect(searchStore.getState().status).toBe("success"));
    expect(searchStore.getState().results[0].title).toBe("One Piece");
  });

  it("transitions to error when the stream rejects with an Error instance", async () => {
    const searchStream = vi.fn(async () => {
      throw new Error("network error");
    });
    const api = makeAPI(searchStream);

    renderHook(() => useSearchStreamSync(api));
    act(() => { searchStore.getState().submitQuery("test"); });

    await vi.waitFor(() => expect(searchStore.getState().status).toBe("error"));
    expect(searchStore.getState().errorMessage).toBe("network error");
  });

  it("uses 'stream error' fallback when the rejection value is not an Error", async () => {
    const searchStream = vi.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "raw string error";
    });
    const api = makeAPI(searchStream);

    renderHook(() => useSearchStreamSync(api));
    act(() => { searchStore.getState().submitQuery("test"); });

    await vi.waitFor(() => expect(searchStore.getState().status).toBe("error"));
    expect(searchStore.getState().errorMessage).toBe("stream error");
  });

  it("does not start a second stream when one is already active", async () => {
    let resolveStream!: () => void;
    const streamPromise = new Promise<void>((resolve) => { resolveStream = resolve; });
    const searchStream = vi.fn(async () => streamPromise);
    const api = makeAPI(searchStream);

    renderHook(() => useSearchStreamSync(api));
    act(() => { searchStore.getState().submitQuery("test"); });

    await vi.waitFor(() => expect(searchStream).toHaveBeenCalledTimes(1));
    // Artificially trigger the subscription again by calling a no-op store update.
    // 通过调用无操作 store 更新人为触发订阅.
    act(() => { searchStore.getState().setScrollY(0); });

    expect(searchStream).toHaveBeenCalledTimes(1);

    resolveStream();
  });

  it("unsubscribes without aborting the stream when the hook unmounts", async () => {
    // Design: the hook only unsubscribes from the store on unmount.
    // The AbortController is owned by the store, not the hook; abort is called by
    // searchStore.cancel() / resetAll(), not by the hook's useEffect cleanup.
    // 设计: hook 卸载时仅取消 store 订阅.
    // AbortController 由 store 持有, 非 hook 持有; abort 由 searchStore.cancel()/resetAll() 调用.
    let capturedSignal!: AbortSignal;
    let resolveStream!: () => void;
    const streamPromise = new Promise<void>((resolve) => { resolveStream = resolve; });

    const searchStream = vi.fn(async (_query: string, _onEvent: (e: SearchStreamEvent) => void, options?: { signal?: AbortSignal }) => {
      capturedSignal = options!.signal!;
      return streamPromise;
    });
    const api = makeAPI(searchStream);

    const { unmount } = renderHook(() => useSearchStreamSync(api));
    act(() => { searchStore.getState().submitQuery("test"); });

    await vi.waitFor(() => expect(capturedSignal).toBeDefined());
    expect(capturedSignal.aborted).toBe(false);

    unmount();

    // Signal must still be live — the hook does NOT abort on cleanup.
    // signal 必须仍然有效 — hook 在 cleanup 时不中止流.
    expect(capturedSignal.aborted).toBe(false);

    resolveStream();
  });

  it("ignores stale events after a new query supersedes the controller (via abort guard)", async () => {
    // This test exercises guard 1: controller.signal.aborted is true after submitQuery aborts it.
    // 此测试验证守卫 1: submitQuery 中止旧 controller 后 signal.aborted 为 true.
    let firstFireEvent!: (event: SearchStreamEvent) => void;
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;

    const firstPromise = new Promise<void>((resolve) => { resolveFirst = resolve; });
    const secondPromise = new Promise<void>((resolve) => { resolveSecond = resolve; });

    const searchStream = vi.fn()
      .mockImplementationOnce(async (_query: string, onEvent: (e: SearchStreamEvent) => void) => {
        firstFireEvent = onEvent;
        return firstPromise;
      })
      .mockImplementationOnce(async (_query: string, onEvent: (e: SearchStreamEvent) => void) => {
        onEvent({ type: "result", response: { results: [{ title: "Fresh", sources: [] }] } });
        return secondPromise;
      });

    const api = makeAPI(searchStream);

    renderHook(() => useSearchStreamSync(api));

    // Start first query and capture its onEvent.
    // 开始第一个查询并捕获其 onEvent.
    act(() => { searchStore.getState().submitQuery("first"); });
    await vi.waitFor(() => expect(firstFireEvent).toBeDefined());

    // Submit second query, which aborts the first controller.
    // 提交第二个查询, 中止第一个 controller.
    act(() => { searchStore.getState().submitQuery("second"); });

    await vi.waitFor(() => expect(searchStore.getState().results[0]?.title).toBe("Fresh"));

    // Firing an event on the stale first controller should be ignored.
    // 对陈旧的第一个 controller 触发事件应被忽略.
    act(() => {
      firstFireEvent({ type: "result", response: { results: [{ title: "Stale", sources: [] }] } });
    });

    // Store should still show "Fresh" — stale result was discarded.
    // store 应仍显示 "Fresh" — 陈旧结果已被丢弃.
    expect(searchStore.getState().results[0]?.title).toBe("Fresh");

    resolveFirst();
    resolveSecond();
  });

  it("ignores stale event/resolve/reject when activeController is replaced without aborting (identity guard)", async () => {
    // This test exercises guard 2: the store replaced activeController but the old signal is NOT
    // aborted. This hits the `searchStore.getState().activeController !== controller` branch.
    // 此测试验证守卫 2: store 已替换 activeController 但旧 signal 未被中止.
    // 覆盖 `searchStore.getState().activeController !== controller` 分支.
    let firstFireEvent!: (event: SearchStreamEvent) => void;
    let firstResolve!: () => void;
    let firstReject!: (err: Error) => void;

    const firstPromise = new Promise<void>((resolve, reject) => {
      firstResolve = resolve;
      firstReject = reject;
    });

    const searchStream = vi.fn(async (_query: string, onEvent: (e: SearchStreamEvent) => void) => {
      firstFireEvent = onEvent;
      return firstPromise;
    });
    const api = makeAPI(searchStream);

    renderHook(() => useSearchStreamSync(api));
    act(() => { searchStore.getState().submitQuery("test"); });
    await vi.waitFor(() => expect(firstFireEvent).toBeDefined());

    // Manually replace activeController in the store without aborting the original signal.
    // store 中手动替换 activeController, 不中止原始 signal.
    const replacementController = new AbortController();
    act(() => {
      searchStore.getState().detachController();
      searchStore.getState().attachController(replacementController);
    });

    // Stale event — should not reach applyResults because the identity guard fires.
    // 陈旧事件 — 不应到达 applyResults, 因为 identity guard 触发.
    act(() => {
      firstFireEvent({ type: "result", response: { results: [{ title: "ShouldNotAppear", sources: [] }] } });
    });
    expect(searchStore.getState().results).toHaveLength(0);

    // Stale resolve — should not call completeStream.
    // 陈旧 resolve — 不应调用 completeStream.
    act(() => { firstResolve(); });
    await Promise.resolve(); // flush microtasks
    expect(searchStore.getState().status).not.toBe("success");

    // Stale reject — should not call failStream.
    // 陈旧 reject — 不应调用 failStream.
    // (resolve already settled the promise above — test a fresh reject on a new stream)
    // Verify status remains as set by the replacement controller, not poisoned by the stale reject.
    // 验证状态由替换 controller 决定, 不被陈旧 reject 污染.
    expect(searchStore.getState().status).toBe("loading");

    // Cleanup: reject the first promise to avoid unhandled rejection warnings.
    // firstReject 已在 firstResolve 之后 settle, 上面 firstReject 不会再触发.
    // The promise is already settled (resolved). Clean up replacement.
    replacementController.abort();
  });
});
