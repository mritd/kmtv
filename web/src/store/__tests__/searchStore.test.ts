import { beforeEach, describe, expect, test } from "vitest";

import { searchStore } from "../searchStore";

beforeEach(() => {
  searchStore.getState().resetAll();
});

describe("searchStore actions", () => {
  test("submitQuery sets status to loading and updates progress", () => {
    searchStore.getState().submitQuery("hello");
    expect(searchStore.getState().status).toBe("loading");
    expect(searchStore.getState().lastSubmittedQuery).toBe("hello");

    searchStore.getState().applyProgressEvent({ phase: "searching", completed: 3, total: 12 });
    expect(searchStore.getState().progressMap.searching).toEqual({ phase: "searching", completed: 3, total: 12 });
  });

  test("applyResults transitions to success", () => {
    searchStore.getState().submitQuery("q");
    searchStore.getState().applyResults([{ title: "t", sources: [] }]);
    searchStore.getState().completeStream();
    expect(searchStore.getState().status).toBe("success");
    expect(searchStore.getState().results).toHaveLength(1);
  });

  test("failStream transitions to error with message", () => {
    searchStore.getState().submitQuery("q");
    searchStore.getState().failStream("boom");
    expect(searchStore.getState().status).toBe("error");
    expect(searchStore.getState().errorMessage).toBe("boom");
  });

  test("resetAll clears state", () => {
    searchStore.getState().submitQuery("q");
    searchStore.getState().resetAll();
    expect(searchStore.getState().status).toBe("idle");
    expect(searchStore.getState().results).toHaveLength(0);
    expect(searchStore.getState().lastSubmittedQuery).toBe("");
  });

  test("submitQuery aborts the prior controller", () => {
    const previous = new AbortController();
    searchStore.getState().attachController(previous);
    expect(searchStore.getState().activeController).toBe(previous);

    searchStore.getState().submitQuery("next");
    expect(previous.signal.aborted).toBe(true);
    // After submit, store is in loading with no controller until SSE attaches a new one.
    // 提交后处于 loading 状态, 新 SSE 附加前 controller 为 null.
    expect(searchStore.getState().activeController).toBeNull();
  });

  test("retryQuery re-runs last submitted query", () => {
    searchStore.getState().submitQuery("first");
    searchStore.getState().failStream("nope");
    expect(searchStore.getState().status).toBe("error");

    searchStore.getState().retryQuery();
    expect(searchStore.getState().status).toBe("loading");
    expect(searchStore.getState().lastSubmittedQuery).toBe("first");
  });

  test("resetAll aborts the active controller so the fetch is torn down", () => {
    const controller = new AbortController();
    searchStore.getState().attachController(controller);

    searchStore.getState().resetAll();
    expect(controller.signal.aborted).toBe(true);
    expect(searchStore.getState().activeController).toBeNull();
  });

  test("stale callbacks from a superseded controller are ignored", () => {
    const stale = new AbortController();
    searchStore.getState().submitQuery("q1");
    searchStore.getState().attachController(stale);

    // Submit a new query, which aborts the stale controller and clears activeController.
    // 提交新 query, 中止旧 controller 并清空 activeController.
    searchStore.getState().submitQuery("q2");
    expect(stale.signal.aborted).toBe(true);

    // The stale stream's late failStream callback must NOT change state.
    // 旧流的迟到 failStream 不能改变状态.
    searchStore.getState().failStream("stale error", stale);
    expect(searchStore.getState().status).toBe("loading");
    expect(searchStore.getState().errorMessage).toBe("");

    // Same for applyResults and completeStream.
    // applyResults
    // 和 completeStream 同理.
    searchStore.getState().applyResults([{ title: "stale", sources: [] }], stale);
    expect(searchStore.getState().results).toHaveLength(0);

    searchStore.getState().completeStream(stale);
    expect(searchStore.getState().status).toBe("loading");
  });
});
