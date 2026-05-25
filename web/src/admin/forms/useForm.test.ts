/**
 * useForm tests — happy path, field updates, cross-field validation, and error injection.
 * useForm 测试 — 正常路径、字段更新、跨字段校验和错误注入.
 *
 * Note: useForm has no reset API and no explicit dirty-state flag.
 * Successive setField calls demonstrate value update and error-clearing behaviour.
 * 注意: useForm 无 reset API, 无显式 dirty 标志.
 * 通过连续 setField 调用验证值更新和错误清除行为.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useForm } from "./useForm";

// Simple form shape used across tests.
// 跨用例复用的简单表单形态.
type TestForm = { name: string; count: number };

const INITIAL: TestForm = { name: "", count: 0 };

describe("useForm", () => {
  describe("initial state", () => {
    it("returns initial values without errors", () => {
      const { result } = renderHook(() => useForm<TestForm>(INITIAL));
      expect(result.current.values).toEqual(INITIAL);
      expect(result.current.errors).toEqual({});
    });
  });

  describe("setField", () => {
    it("updates the target field and leaves others unchanged", () => {
      const { result } = renderHook(() => useForm<TestForm>(INITIAL));
      act(() => {
        result.current.setField("name", "hello");
      });
      expect(result.current.values.name).toBe("hello");
      // Other field must remain at initial value.
      // 其他字段保持初始值.
      expect(result.current.values.count).toBe(0);
    });

    it("clears the field's error when the field is changed", () => {
      const { result } = renderHook(() =>
        useForm<TestForm>(INITIAL, {
          name: (v) => (v ? undefined : "required"),
        }),
      );
      // Trigger validation to populate the error.
      // 触发校验以填充错误.
      act(() => {
        result.current.validate();
      });
      expect(result.current.errors.name).toBe("required");

      // Now type into the field — error should be cleared immediately.
      // 输入字段 — 错误应立即清除.
      act(() => {
        result.current.setField("name", "x");
      });
      expect(result.current.errors.name).toBeUndefined();
    });

    it("does not clear an unrelated field's error when another field changes", () => {
      type F2 = { a: string; b: string };
      const { result } = renderHook(() =>
        useForm<F2>({ a: "", b: "" }, {
          a: (v) => (v ? undefined : "a required"),
          b: (v) => (v ? undefined : "b required"),
        }),
      );
      act(() => { result.current.validate(); });
      expect(result.current.errors.a).toBe("a required");
      expect(result.current.errors.b).toBe("b required");

      // Fix field b — field a's error should remain.
      // 修复 b 字段 — a 字段的错误应保留.
      act(() => { result.current.setField("b", "ok"); });
      expect(result.current.errors.a).toBe("a required");
      expect(result.current.errors.b).toBeUndefined();
    });
  });

  describe("validate", () => {
    it("returns true and sets no errors when all validators pass", () => {
      const { result } = renderHook(() =>
        useForm<TestForm>({ name: "Bob", count: 1 }, {
          name: (v) => (v ? undefined : "required"),
          count: (v) => (v > 0 ? undefined : "positive"),
        }),
      );
      let ok = false;
      act(() => { ok = result.current.validate(); });
      expect(ok).toBe(true);
      expect(result.current.errors).toEqual({});
    });

    it("returns false and populates errors when validators fail", () => {
      const { result } = renderHook(() =>
        useForm<TestForm>(INITIAL, {
          name: (v) => (v ? undefined : "name required"),
          count: (v) => (v > 0 ? undefined : "must be positive"),
        }),
      );
      let ok = true;
      act(() => { ok = result.current.validate(); });
      expect(ok).toBe(false);
      expect(result.current.errors.name).toBe("name required");
      expect(result.current.errors.count).toBe("must be positive");
    });

    it("returns true immediately when no validators are provided", () => {
      const { result } = renderHook(() => useForm<TestForm>(INITIAL));
      let ok = false;
      act(() => { ok = result.current.validate(); });
      expect(ok).toBe(true);
    });

    it("cross-field validator can access the full form", () => {
      type Pwd = { password: string; confirm: string };
      const { result } = renderHook(() =>
        useForm<Pwd>({ password: "abc", confirm: "xyz" }, {
          confirm: (v, form) => (v === form.password ? undefined : "mismatch"),
        }),
      );
      let ok = true;
      act(() => { ok = result.current.validate(); });
      expect(ok).toBe(false);
      expect(result.current.errors.confirm).toBe("mismatch");
    });
  });

  describe("setErrors (imperative cross-field injection)", () => {
    it("allows callers to inject errors imperatively", () => {
      const { result } = renderHook(() => useForm<TestForm>(INITIAL));
      act(() => {
        result.current.setErrors({ name: "injected error" });
      });
      expect(result.current.errors.name).toBe("injected error");
    });

    it("allows clearing an injected error imperatively", () => {
      const { result } = renderHook(() => useForm<TestForm>(INITIAL));
      act(() => {
        result.current.setErrors({ name: "injected error" });
      });
      act(() => {
        result.current.setErrors({});
      });
      expect(result.current.errors.name).toBeUndefined();
    });
  });

  describe("successive updates via setField", () => {
    it("reflects the latest value after multiple setField calls", () => {
      const { result } = renderHook(() => useForm<TestForm>(INITIAL));
      act(() => { result.current.setField("name", "Alice"); });
      act(() => { result.current.setField("name", "Bob"); });
      expect(result.current.values.name).toBe("Bob");
    });
  });
});
