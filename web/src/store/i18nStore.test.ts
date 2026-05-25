/**
 * Tests for useI18nStore — device-level language preference with localStorage persistence.
 * useI18nStore 测试 — 带 localStorage 持久化的设备级语言偏好 store.
 *
 * Baseline coverage was 75% statements / 100% branches.
 * Uncovered lines per baseline-coverage.txt: 19-20 (setLang / reset action bodies).
 *
 * 基线覆盖率: statements 75% / branches 100%.
 * 未覆盖行: 19-20 (setLang / reset action 函数体).
 */

import { beforeEach, describe, expect, it } from "vitest";

import { useI18nStore } from "./i18nStore";
import type { Lang } from "./i18nStore";

// ---------------------------------------------------------------------------
// Reset before each test — mirror setup.ts
// 每个测试前重置 — 与 setup.ts 保持一致
// ---------------------------------------------------------------------------

beforeEach(() => {
  useI18nStore.setState({ lang: "zh" });
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useI18nStore", () => {
  describe("after reset (setState contract)", () => {
    // These tests verify the post-reset state enforced by setState({ lang: "zh" }) in beforeEach.
    // The module-level initial value is also "zh", but testing it in isolation would need a
    // fresh import; these cases pin the reset-state contract instead.
    // 这些测试验证 setState({ lang: "zh" }) 执行后的重置状态.
    // 模块级初始值同为 "zh", 但隔离测试需要新 import — 此处锁定重置契约.
    it("lang is zh after reset (default value contract)", () => {
      expect(useI18nStore.getState().lang).toBe("zh");
    });
  });

  describe("setLang()", () => {
    it("updates lang to en (was uncovered — line 19)", () => {
      useI18nStore.getState().setLang("en");
      expect(useI18nStore.getState().lang).toBe("en");
    });

    it("updates lang to zh explicitly", () => {
      // Start from en so this is a real transition.
      // 从 en 开始确保这是一次真实切换.
      useI18nStore.getState().setLang("en");
      useI18nStore.getState().setLang("zh");
      expect(useI18nStore.getState().lang).toBe("zh");
    });

    it("accepts all valid Lang values without type error", () => {
      const langs: Lang[] = ["zh", "en"];
      for (const lang of langs) {
        useI18nStore.getState().setLang(lang);
        expect(useI18nStore.getState().lang).toBe(lang);
      }
    });
  });

  describe("reset()", () => {
    it("restores lang to zh from en (was uncovered — line 20)", () => {
      // Change language first so reset() has something to revert.
      // 先切换语言, 确保 reset() 有实际还原动作.
      useI18nStore.getState().setLang("en");
      expect(useI18nStore.getState().lang).toBe("en");

      useI18nStore.getState().reset();
      expect(useI18nStore.getState().lang).toBe("zh");
    });

    it("is idempotent when lang is already zh", () => {
      // Calling reset() when lang is already the default must be a safe no-op.
      // lang 已经是默认值时调用 reset() 必须安全无操作.
      useI18nStore.getState().reset();
      useI18nStore.getState().reset();
      expect(useI18nStore.getState().lang).toBe("zh");
    });
  });

  describe("persistence contract", () => {
    it("writes under the kmtv.lang key (TIER 4 locked)", () => {
      // If this test fails a Tier-4 forbidden key rename occurred.
      // 该测试锁定 key 名称, 失败则表示发生了 Tier-4 禁止变更.
      useI18nStore.getState().setLang("en");
      // Zustand persist writes on the next microtask; check presence after allowing it to settle.
      // Zustand persist 在下一个微任务中写入; 等待稳定后检查.
      const raw = localStorage.getItem("kmtv.lang");
      // The key must be present and contain "en".
      // key 必须存在且包含 "en".
      expect(raw).not.toBeNull();
      if (raw) {
        expect(JSON.parse(raw)).toMatchObject({ state: { lang: "en" } });
      }
    });
  });
});
