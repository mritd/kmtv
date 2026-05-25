import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { APIClient } from "@/api/client";
import type { SearchStreamEvent } from "@/api/types";
import { searchStore } from "@/store/searchStore";
import { createTestAPI } from "@/test/testAPI";

import { useSearchStreamSync } from "../useSearchStreamSync";

beforeEach(() => {
  searchStore.getState().resetAll();
});

// ScriptedSearchEvent uses Extract so each variant's payload is typed correctly.
// ScriptedSearchEvent
// 用 Extract 让每个分支 payload 类型正确.
type ScriptedSearchEvent =
  | { kind: "progress"; data: Extract<SearchStreamEvent, { type: "progress" }>["progress"] }
  | { kind: "result"; data: Extract<SearchStreamEvent, { type: "result" }>["response"]["results"] }
  | { kind: "error"; data: string };

// scriptedSearchAPI builds an APIClient mock that emits a scripted SSE sequence.
// scriptedSearchAPI
// 构建一个按脚本发送 SSE 序列的 APIClient mock.
type SearchStreamFn = APIClient["searchStream"];
type SearchStreamMock = Mock<SearchStreamFn>;

function scriptedSearchAPI(events: ScriptedSearchEvent[]): { api: APIClient; searchStream: SearchStreamMock } {
  const searchStream = vi.fn<SearchStreamFn>(async (_query, onEvent, opts) => {
    for (const e of events) {
      if (opts?.signal?.aborted) return;
      if (e.kind === "progress") onEvent({ type: "progress", progress: e.data });
      else if (e.kind === "result") onEvent({ type: "result", response: { results: e.data } });
      else onEvent({ type: "error", message: e.data });
    }
  });
  return { api: createTestAPI({ searchStream }), searchStream };
}

describe("useSearchStreamSync", () => {
  it("submitQuery starts a stream and attaches a controller", async () => {
    const { api, searchStream } = scriptedSearchAPI([{ kind: "result", data: [] }]);
    renderHook(() => useSearchStreamSync(api));

    act(() => searchStore.getState().submitQuery("q"));
    await Promise.resolve();
    expect(searchStream).toHaveBeenCalledTimes(1);
  });

  it("route unmount does NOT cancel an active stream", async () => {
    const { api } = scriptedSearchAPI([{ kind: "progress", data: { phase: "searching", completed: 1, total: 12 } }]);
    const { unmount } = renderHook(() => useSearchStreamSync(api));
    act(() => searchStore.getState().submitQuery("q"));
    const controller = searchStore.getState().activeController;
    unmount();
    expect(controller?.signal.aborted).toBe(false);
  });

  it("re-emits when status is loading but controller is null (orphan)", async () => {
    const { api, searchStream } = scriptedSearchAPI([{ kind: "result", data: [{ title: "x", sources: [] }] }]);
    renderHook(() => useSearchStreamSync(api));
    // Synthesize an orphan:
    // loading without a controller.
    // 构造孤儿状态: loading 但无控制器.
    act(() => {
      searchStore.setState({ status: "loading", lastSubmittedQuery: "q", activeController: null });
    });
    await Promise.resolve();
    expect(searchStream).toHaveBeenCalledTimes(1);
  });

  it("supersede A with B starts B exactly once and does NOT restart A", async () => {
    const scriptA = scriptedSearchAPI([{ kind: "progress", data: { phase: "searching", completed: 1, total: 12 } }]);
    renderHook(() => useSearchStreamSync(scriptA.api));
    act(() => searchStore.getState().submitQuery("A"));
    await Promise.resolve();
    expect(scriptA.searchStream).toHaveBeenCalledTimes(1);
    expect(scriptA.searchStream.mock.calls[0][0]).toBe("A");

    act(() => searchStore.getState().submitQuery("B"));
    await Promise.resolve();
    expect(scriptA.searchStream.mock.calls.map((c: unknown[]) => c[0])).toEqual(["A", "B"]);
    expect(searchStore.getState().lastSubmittedQuery).toBe("B");
  });

  it("stale events from a superseded controller do not mutate state", async () => {
    type Emit = (event: SearchStreamEvent) => void;
    // Box the emit handler so a captured closure assignment is visible after `await`.
    // 用对象包装 emit, 避免 TS 在 await 后把变量收窄回 null.
    const slot: { emit: Emit | null } = { emit: null };
    const searchStream: APIClient["searchStream"] = vi.fn(async (_q, onEvent) => {
      slot.emit = onEvent;
      // Hang until the test fires the late event manually.
      // 挂起直到测试手动触发 late event.
      await new Promise(() => undefined);
    });
    const api = createTestAPI({ searchStream });
    renderHook(() => useSearchStreamSync(api));
    act(() => searchStore.getState().submitQuery("A"));
    await Promise.resolve();
    expect(slot.emit).not.toBeNull();
    const captured = slot.emit as Emit;

    act(() => searchStore.getState().submitQuery("B"));
    await Promise.resolve();
    // Now have A's onEvent fire a stale result.
    // 让 A 的 onEvent 发出过期结果.
    act(() => captured({ type: "result", response: { results: [{ title: "STALE", sources: [] }] } }));
    expect(searchStore.getState().results).toEqual([]);
  });
});
