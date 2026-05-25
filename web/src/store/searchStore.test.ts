/**
 * Tests for searchStore — SSE-backed search lifecycle store.
 * searchStore 测试 — 支持 SSE 的搜索生命周期 store.
 *
 * Baseline coverage: 71.79% statements / 63.63% branches.
 * Uncovered lines: 70-71 (retryQuery with empty lastSubmittedQuery), 111-121 (cancel branches).
 *
 * This file covers: all cancel() reason branches, retryQuery no-op when query is empty,
 * applyProgressEvent with unknown phase, detachController, setQueryText, setScrollY,
 * and the no-active-controller path in cancel() and resetAll().
 *
 * 基线覆盖率: statements 71.79% / branches 63.63%.
 * 未覆盖行: 70-71 (lastSubmittedQuery 为空时 retryQuery 无操作), 111-121 (cancel 分支).
 * 本文件覆盖: 所有 cancel() 原因分支、lastSubmittedQuery 为空时 retryQuery、
 * 未知 phase 的 applyProgressEvent、detachController、setQueryText、setScrollY、
 * cancel() 和 resetAll() 中无活动 controller 的路径.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { searchStore } from "./searchStore";

// ---------------------------------------------------------------------------
// Reset before each test
// 每个测试前重置
// ---------------------------------------------------------------------------

beforeEach(() => {
  searchStore.getState().resetAll();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("searchStore", () => {
  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("after resetAll() (state contract)", () => {
    // These tests verify the post-reset state enforced by resetAll() in beforeEach.
    // The module-level initial state is identical, but testing it in isolation would
    // require a fresh module import — these cases pin the resetAll() contract instead.
    // 这些测试验证 resetAll() 执行后的重置状态.
    // 模块级初始状态与重置后相同, 但隔离测试需要新 import — 此处锁定 resetAll() 契约.
    it("all fields return to blank initial values after resetAll()", () => {
      const s = searchStore.getState();
      expect(s.status).toBe("idle");
      expect(s.queryText).toBe("");
      expect(s.lastSubmittedQuery).toBe("");
      expect(s.results).toHaveLength(0);
      expect(s.progressMap).toEqual({});
      expect(s.errorMessage).toBe("");
      expect(s.scrollY).toBe(0);
      expect(s.activeController).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // setQueryText / setScrollY
  // -------------------------------------------------------------------------

  describe("setQueryText()", () => {
    it("updates queryText without affecting status or results", () => {
      searchStore.getState().setQueryText("hello");
      expect(searchStore.getState().queryText).toBe("hello");
      expect(searchStore.getState().status).toBe("idle");
    });
  });

  describe("setScrollY()", () => {
    it("saves the scroll offset for back-navigation restoration", () => {
      searchStore.getState().setScrollY(450);
      expect(searchStore.getState().scrollY).toBe(450);
    });
  });

  // -------------------------------------------------------------------------
  // submitQuery
  // -------------------------------------------------------------------------

  describe("submitQuery()", () => {
    it("transitions to loading and records the submitted query", () => {
      searchStore.getState().submitQuery("test query");
      expect(searchStore.getState().status).toBe("loading");
      expect(searchStore.getState().lastSubmittedQuery).toBe("test query");
      expect(searchStore.getState().results).toHaveLength(0);
      expect(searchStore.getState().progressMap).toEqual({});
      expect(searchStore.getState().errorMessage).toBe("");
    });

    it("aborts the previous controller when superseding a query", () => {
      const prev = new AbortController();
      searchStore.getState().attachController(prev);
      searchStore.getState().submitQuery("next query");
      expect(prev.signal.aborted).toBe(true);
      expect(searchStore.getState().activeController).toBeNull();
    });

    it("works without a previous controller (no-op abort path)", () => {
      // submitQuery when activeController is null must not throw.
      // activeController 为 null 时调用 submitQuery 不应抛出异常.
      expect(() => { searchStore.getState().submitQuery("query"); }).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // retryQuery — including the empty-query no-op branch (was uncovered: lines 70-71)
  // -------------------------------------------------------------------------

  describe("retryQuery()", () => {
    it("re-submits the last submitted query when one exists", () => {
      searchStore.getState().submitQuery("first");
      searchStore.getState().failStream("boom");
      expect(searchStore.getState().status).toBe("error");

      searchStore.getState().retryQuery();
      expect(searchStore.getState().status).toBe("loading");
      expect(searchStore.getState().lastSubmittedQuery).toBe("first");
    });

    it("is a no-op when lastSubmittedQuery is empty (guard branch — was uncovered)", () => {
      // retryQuery with an empty lastSubmittedQuery must not change the status.
      // lastSubmittedQuery 为空时 retryQuery 不得改变状态.
      expect(searchStore.getState().lastSubmittedQuery).toBe("");
      searchStore.getState().retryQuery();
      // Status must remain idle — no spurious loading transition.
      // 状态必须保持 idle — 不得触发虚假的 loading 转换.
      expect(searchStore.getState().status).toBe("idle");
    });
  });

  // -------------------------------------------------------------------------
  // applyProgressEvent — including unknown phase drop (was partially uncovered)
  // -------------------------------------------------------------------------

  describe("applyProgressEvent()", () => {
    it("merges a searching progress event into progressMap", () => {
      searchStore.getState().submitQuery("q");
      const ctrl = new AbortController();
      searchStore.getState().attachController(ctrl);
      searchStore.getState().applyProgressEvent({ phase: "searching", completed: 5, total: 20 }, ctrl);
      expect(searchStore.getState().progressMap.searching).toEqual({ phase: "searching", completed: 5, total: 20 });
    });

    it("merges a probing progress event into progressMap", () => {
      searchStore.getState().submitQuery("q");
      const ctrl = new AbortController();
      searchStore.getState().attachController(ctrl);
      searchStore.getState().applyProgressEvent({ phase: "probing", completed: 2, total: 10 }, ctrl);
      expect(searchStore.getState().progressMap.probing).toEqual({ phase: "probing", completed: 2, total: 10 });
    });

    it("silently drops events with an unknown phase (filter branch)", () => {
      searchStore.getState().submitQuery("q");
      const ctrl = new AbortController();
      searchStore.getState().attachController(ctrl);
      // Simulate a backend sending an unexpected phase value.
      // 模拟后端发送未知 phase 值.
      searchStore.getState().applyProgressEvent(
        { phase: "unknown-phase" as "searching", completed: 0, total: 0 },
        ctrl,
      );
      expect(searchStore.getState().progressMap).toEqual({});
    });

    it("ignores events from a stale controller", () => {
      const stale = new AbortController();
      searchStore.getState().submitQuery("q1");
      searchStore.getState().attachController(stale);
      searchStore.getState().submitQuery("q2");

      searchStore.getState().applyProgressEvent({ phase: "searching", completed: 1, total: 5 }, stale);
      expect(searchStore.getState().progressMap).toEqual({});
    });

    it("accepts events with no controller (broadcast mode)", () => {
      // When controller is undefined the store does not filter by identity.
      // controller 为 undefined 时 store 不按身份过滤.
      searchStore.getState().submitQuery("q");
      searchStore.getState().applyProgressEvent({ phase: "searching", completed: 1, total: 5 });
      expect(searchStore.getState().progressMap.searching).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // applyResults
  // -------------------------------------------------------------------------

  describe("applyResults()", () => {
    it("replaces the results list with the incoming array", () => {
      searchStore.getState().submitQuery("q");
      const ctrl = new AbortController();
      searchStore.getState().attachController(ctrl);
      searchStore.getState().applyResults([{ title: "A", sources: [] }, { title: "B", sources: [] }], ctrl);
      expect(searchStore.getState().results).toHaveLength(2);
    });

    it("ignores results from a stale controller", () => {
      const stale = new AbortController();
      searchStore.getState().submitQuery("q1");
      searchStore.getState().attachController(stale);
      searchStore.getState().submitQuery("q2");

      searchStore.getState().applyResults([{ title: "stale", sources: [] }], stale);
      expect(searchStore.getState().results).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // completeStream
  // -------------------------------------------------------------------------

  describe("completeStream()", () => {
    it("transitions to success and clears activeController", () => {
      const ctrl = new AbortController();
      searchStore.getState().submitQuery("q");
      searchStore.getState().attachController(ctrl);
      searchStore.getState().completeStream(ctrl);
      expect(searchStore.getState().status).toBe("success");
      expect(searchStore.getState().activeController).toBeNull();
    });

    it("ignores completion from a stale controller", () => {
      const stale = new AbortController();
      searchStore.getState().submitQuery("q1");
      searchStore.getState().attachController(stale);
      searchStore.getState().submitQuery("q2");

      searchStore.getState().completeStream(stale);
      expect(searchStore.getState().status).toBe("loading");
    });
  });

  // -------------------------------------------------------------------------
  // failStream
  // -------------------------------------------------------------------------

  describe("failStream()", () => {
    it("transitions to error with the provided message", () => {
      searchStore.getState().submitQuery("q");
      searchStore.getState().failStream("network timeout");
      expect(searchStore.getState().status).toBe("error");
      expect(searchStore.getState().errorMessage).toBe("network timeout");
      expect(searchStore.getState().activeController).toBeNull();
    });

    it("ignores failure from a stale controller", () => {
      const stale = new AbortController();
      searchStore.getState().submitQuery("q1");
      searchStore.getState().attachController(stale);
      searchStore.getState().submitQuery("q2");

      searchStore.getState().failStream("stale error", stale);
      expect(searchStore.getState().status).toBe("loading");
      expect(searchStore.getState().errorMessage).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // attachController / detachController
  // -------------------------------------------------------------------------

  describe("attachController()", () => {
    it("registers the SSE controller on the store", () => {
      const ctrl = new AbortController();
      searchStore.getState().attachController(ctrl);
      expect(searchStore.getState().activeController).toBe(ctrl);
    });
  });

  describe("detachController()", () => {
    it("clears activeController without aborting it (was uncovered)", () => {
      // detachController is distinct from cancel: it does not abort the signal.
      // detachController 与 cancel 不同: 不会 abort 信号.
      const ctrl = new AbortController();
      searchStore.getState().attachController(ctrl);
      searchStore.getState().detachController();
      expect(searchStore.getState().activeController).toBeNull();
      // The controller must NOT have been aborted — it may still be in use externally.
      // controller 不得被 abort — 外部可能仍在使用.
      expect(ctrl.signal.aborted).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // cancel() — all reason branches (was largely uncovered: lines 111-121)
  // -------------------------------------------------------------------------

  describe("cancel()", () => {
    it("aborts the active controller and moves to idle for reason=user (was uncovered)", () => {
      const ctrl = new AbortController();
      searchStore.getState().submitQuery("q");
      searchStore.getState().attachController(ctrl);

      searchStore.getState().cancel("user");

      expect(ctrl.signal.aborted).toBe(true);
      expect(searchStore.getState().status).toBe("idle");
      expect(searchStore.getState().activeController).toBeNull();
    });

    it("aborts and moves to idle for reason=supersede (was uncovered)", () => {
      const ctrl = new AbortController();
      searchStore.getState().submitQuery("q");
      searchStore.getState().attachController(ctrl);

      searchStore.getState().cancel("supersede");

      expect(ctrl.signal.aborted).toBe(true);
      expect(searchStore.getState().status).toBe("idle");
    });

    it("aborts and moves to idle for reason=auth (was uncovered)", () => {
      const ctrl = new AbortController();
      searchStore.getState().submitQuery("q");
      searchStore.getState().attachController(ctrl);

      searchStore.getState().cancel("auth");

      expect(ctrl.signal.aborted).toBe(true);
      expect(searchStore.getState().status).toBe("idle");
    });

    it("only clears controller for reason=completed (status remains, was uncovered)", () => {
      // "completed" is a terminal marker — status is already "success" via completeStream.
      // completeStream itself nullifies the controller; this tests the cancel("completed") path directly.
      // "completed" 是终态标记 — 状态已由 completeStream 置为 "success"; 此处直接测试 cancel("completed") 路径.
      const ctrl = new AbortController();
      searchStore.getState().submitQuery("q");
      searchStore.getState().attachController(ctrl);
      // Force status to success to simulate completed stream state.
      // 强制 status 为 success 模拟已完成流状态.
      searchStore.getState().applyResults([{ title: "r", sources: [] }]);
      searchStore.getState().completeStream();
      // Re-attach a controller to test the abort path.
      // 重新附加 controller 测试 abort 路径.
      const ctrl2 = new AbortController();
      searchStore.getState().attachController(ctrl2);

      searchStore.getState().cancel("completed");

      expect(ctrl2.signal.aborted).toBe(true);
      // Status must stay "success" — cancel("completed") must NOT reset it to idle.
      // status 必须保持 "success" — cancel("completed") 不得将其重置为 idle.
      expect(searchStore.getState().status).toBe("success");
      expect(searchStore.getState().activeController).toBeNull();
    });

    it("only clears controller for reason=failed (was uncovered)", () => {
      const ctrl = new AbortController();
      searchStore.getState().submitQuery("q");
      searchStore.getState().failStream("err");
      // Re-attach to test the abort path.
      // 重新附加 controller 测试 abort 路径.
      searchStore.getState().attachController(ctrl);

      searchStore.getState().cancel("failed");

      expect(ctrl.signal.aborted).toBe(true);
      // Status must stay "error" — cancel("failed") must NOT reset it to idle.
      // status 必须保持 "error" — cancel("failed") 不得将其重置为 idle.
      expect(searchStore.getState().status).toBe("error");
      expect(searchStore.getState().activeController).toBeNull();
    });

    it("is a no-op on the controller when none is active", () => {
      // cancel() without an activeController must not throw.
      // 无活动 controller 时调用 cancel() 不应抛出异常.
      expect(searchStore.getState().activeController).toBeNull();
      expect(() => { searchStore.getState().cancel("user"); }).not.toThrow();
      expect(searchStore.getState().status).toBe("idle");
    });
  });

  // -------------------------------------------------------------------------
  // resetAll()
  // -------------------------------------------------------------------------

  describe("resetAll()", () => {
    it("aborts the active controller and wipes all state to initial values", () => {
      const ctrl = new AbortController();
      searchStore.getState().submitQuery("q");
      searchStore.getState().attachController(ctrl);
      searchStore.getState().applyResults([{ title: "r", sources: [] }]);
      searchStore.getState().setScrollY(300);

      searchStore.getState().resetAll();

      expect(ctrl.signal.aborted).toBe(true);
      expect(searchStore.getState().status).toBe("idle");
      expect(searchStore.getState().results).toHaveLength(0);
      expect(searchStore.getState().lastSubmittedQuery).toBe("");
      expect(searchStore.getState().progressMap).toEqual({});
      expect(searchStore.getState().scrollY).toBe(0);
      expect(searchStore.getState().activeController).toBeNull();
    });

    it("does not throw when there is no active controller", () => {
      // resetAll without a controller must gracefully skip the abort call.
      // 无活动 controller 时 resetAll 必须优雅地跳过 abort 调用.
      expect(searchStore.getState().activeController).toBeNull();
      expect(() => { searchStore.getState().resetAll(); }).not.toThrow();
    });
  });
});
