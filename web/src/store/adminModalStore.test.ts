/**
 * Tests for adminModalStore — single-active-modal controller for the admin panel.
 * 管理弹窗 store 测试 — 管理面板的单活动弹窗控制器.
 *
 * Covers: initial state, open(), close(), payload replacement, all AdminModalPayload variants.
 * 覆盖: 初始状态、open()、close()、payload 替换、所有 AdminModalPayload 变体.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { adminModalStore } from "./adminModalStore";
import type { AdminModalPayload } from "./adminModalStore";
import type { AdminUser, Source, Subscription } from "@/api/types";

// ---------------------------------------------------------------------------
// Test fixtures — minimal objects satisfying the API types
// 测试夹具 — 满足 API 类型的最小对象
// ---------------------------------------------------------------------------

const minimalSource: Source = {
  id: 1,
  key: "src-key",
  name: "Test Source",
  api: "https://api.example.com",
  detail: "https://detail.example.com",
  enabled: true,
  searchable: true,
  is_adult: false,
  comment: "",
  health: "healthy",
  last_check: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const minimalSubscription: Subscription = {
  id: 1,
  url: "https://sub.example.com",
  auto_update: false,
  interval: 86400,
  last_sync: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const minimalUser: AdminUser = {
  id: 1,
  username: "admin",
  role: "admin",
  allow_adult_content: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

// ---------------------------------------------------------------------------
// Reset before each test — mirrors the setup.ts pattern
// 每个测试前重置 — 与 setup.ts 模式一致
// ---------------------------------------------------------------------------

beforeEach(() => {
  adminModalStore.getState().close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("adminModalStore", () => {
  describe("after reset (close() contract)", () => {
    // These tests verify the post-reset state enforced by close() and beforeEach.
    // The true module-level initial state is identical, but testing it in isolation
    // would require a fresh module import — these cases pin the reset contract instead.
    // 这些测试验证 close() 和 beforeEach 执行后的重置状态.
    // 模块级初始状态与重置后相同, 但隔离测试需要新 import — 此处锁定重置契约.
    it("current is null after close() (no modal open)", () => {
      expect(adminModalStore.getState().current).toBeNull();
    });
  });

  describe("open()", () => {
    it("sets current to the given payload", () => {
      adminModalStore.getState().open({ kind: "source.new" });
      expect(adminModalStore.getState().current?.kind).toBe("source.new");
    });

    it("replaces a previously open payload without an explicit close()", () => {
      // Opening a second modal must not require the caller to close first.
      // 打开第二个弹窗不需要调用方先显式关闭.
      adminModalStore.getState().open({ kind: "source.new" });
      adminModalStore.getState().open({ kind: "subscription.new" });
      expect(adminModalStore.getState().current?.kind).toBe("subscription.new");
    });

    it("carries source data for source.edit payload", () => {
      const payload: AdminModalPayload = { kind: "source.edit", source: minimalSource };
      adminModalStore.getState().open(payload);
      const current = adminModalStore.getState().current;
      expect(current?.kind).toBe("source.edit");
      if (current?.kind === "source.edit") {
        expect(current.source.id).toBe(minimalSource.id);
        expect(current.source.key).toBe(minimalSource.key);
      }
    });

    it("carries source data for source.delete payload", () => {
      adminModalStore.getState().open({ kind: "source.delete", source: minimalSource });
      const current = adminModalStore.getState().current;
      expect(current?.kind).toBe("source.delete");
      if (current?.kind === "source.delete") {
        expect(current.source.id).toBe(1);
      }
    });

    it("handles source.import (no extra data required)", () => {
      adminModalStore.getState().open({ kind: "source.import" });
      expect(adminModalStore.getState().current?.kind).toBe("source.import");
    });

    it("carries subscription data for subscription.edit payload", () => {
      adminModalStore.getState().open({ kind: "subscription.edit", subscription: minimalSubscription });
      const current = adminModalStore.getState().current;
      expect(current?.kind).toBe("subscription.edit");
      if (current?.kind === "subscription.edit") {
        expect(current.subscription.id).toBe(minimalSubscription.id);
      }
    });

    it("carries subscription data for subscription.delete payload", () => {
      adminModalStore.getState().open({ kind: "subscription.delete", subscription: minimalSubscription });
      const current = adminModalStore.getState().current;
      expect(current?.kind).toBe("subscription.delete");
      if (current?.kind === "subscription.delete") {
        expect(current.subscription.id).toBe(1);
      }
    });

    it("carries user data for user.edit payload", () => {
      adminModalStore.getState().open({ kind: "user.edit", user: minimalUser });
      const current = adminModalStore.getState().current;
      expect(current?.kind).toBe("user.edit");
      if (current?.kind === "user.edit") {
        expect(current.user.id).toBe(minimalUser.id);
        expect(current.user.username).toBe("admin");
      }
    });

    it("carries user data for user.delete payload", () => {
      adminModalStore.getState().open({ kind: "user.delete", user: minimalUser });
      const current = adminModalStore.getState().current;
      expect(current?.kind).toBe("user.delete");
      if (current?.kind === "user.delete") {
        expect(current.user.id).toBe(1);
      }
    });

    it("carries user data for user.password payload", () => {
      adminModalStore.getState().open({ kind: "user.password", user: minimalUser });
      const current = adminModalStore.getState().current;
      expect(current?.kind).toBe("user.password");
      if (current?.kind === "user.password") {
        expect(current.user.role).toBe("admin");
      }
    });
  });

  describe("close()", () => {
    it("sets current to null when a modal is open", () => {
      adminModalStore.getState().open({ kind: "source.new" });
      adminModalStore.getState().close();
      expect(adminModalStore.getState().current).toBeNull();
    });

    it("is idempotent when called while already closed", () => {
      // Calling close() on an already-closed store must not throw or corrupt state.
      // 在已关闭的 store 上调用 close() 不应抛出异常或破坏状态.
      adminModalStore.getState().close();
      adminModalStore.getState().close();
      expect(adminModalStore.getState().current).toBeNull();
    });
  });

  describe("subscriber notifications", () => {
    it("notifies subscribers when the modal opens and closes", () => {
      const snapshots: Array<AdminModalPayload | null> = [];
      // vanilla createStore.subscribe receives (newState, prevState).
      // vanilla createStore.subscribe 接收 (newState, prevState).
      const unsub = adminModalStore.subscribe((state) => {
        snapshots.push(state.current);
      });

      adminModalStore.getState().open({ kind: "user.new" });
      adminModalStore.getState().close();
      unsub();

      expect(snapshots).toHaveLength(2);
      expect(snapshots[0]?.kind).toBe("user.new");
      expect(snapshots[1]).toBeNull();
    });
  });
});
