/**
 * Tests for ThemeProvider and useTheme.
 * Covers: default theme, switching themes, custom theme apply/clear,
 * localStorage round-trip (via injected ThemeStore), DOM CSS variable application,
 * and useTheme fallback when rendered outside ThemeProvider.
 *
 * ThemeProvider 和 useTheme 的测试.
 * 涵盖: 默认主题, 主题切换, 自定义主题应用/清除, localStorage 往返 (通过注入 ThemeStore),
 * DOM CSS 变量应用, 以及在 ThemeProvider 外使用 useTheme 的降级行为.
 */

import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { ThemeProvider, useTheme } from "./ThemeProvider";
import { createMemoryThemeStore } from "./themes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wraps renderHook inside a ThemeProvider using an injected in-memory store. */
function renderWithProvider(store = createMemoryThemeStore()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ThemeProvider store={store}>{children}</ThemeProvider>
  );
  return renderHook(() => useTheme(), { wrapper });
}

// ---------------------------------------------------------------------------
// useTheme — outside-provider fallback
// ---------------------------------------------------------------------------

describe("useTheme", () => {
  describe("when rendered outside ThemeProvider", () => {
    it("returns the default nocturne preference without crashing", () => {
      const { result } = renderHook(() => useTheme());
      expect(result.current.preference).toEqual({ id: "nocturne" });
    });

    it("setTheme is a no-op function (does not throw)", () => {
      const { result } = renderHook(() => useTheme());
      expect(() => result.current.setTheme({ id: "graphite" })).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// ThemeProvider — default theme
// ---------------------------------------------------------------------------

describe("ThemeProvider", () => {
  describe("default theme", () => {
    it("exposes the store's initial preference as the current preference", () => {
      // createMemoryThemeStore() defaults to nocturne.
      // createMemoryThemeStore() 默认使用 nocturne.
      const { result } = renderWithProvider();
      expect(result.current.preference).toEqual({ id: "nocturne" });
    });

    it("applies data-theme=nocturne on document.documentElement by default", () => {
      renderWithProvider();
      expect(document.documentElement.dataset.theme).toBe("nocturne");
    });

    it("sets nocturne CSS variables on document.documentElement (spot-check --bg)", () => {
      renderWithProvider();
      // Nocturne --bg is #05070d per themes.ts builtInThemes definition.
      // Nocturne --bg 的值为 #05070d, 见 themes.ts builtInThemes 定义.
      expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#05070d");
    });
  });

  // ---------------------------------------------------------------------------
  // Theme switching
  // ---------------------------------------------------------------------------

  describe("switching to a built-in theme", () => {
    it("updates the preference returned by useTheme", () => {
      const { result } = renderWithProvider();
      act(() => {
        result.current.setTheme({ id: "graphite" });
      });
      expect(result.current.preference).toEqual({ id: "graphite" });
    });

    it("updates data-theme attribute on document.documentElement", () => {
      const { result } = renderWithProvider();
      act(() => {
        result.current.setTheme({ id: "graphite" });
      });
      expect(document.documentElement.dataset.theme).toBe("graphite");
    });

    it("updates CSS variables on document.documentElement after switch", () => {
      const { result } = renderWithProvider();
      act(() => {
        result.current.setTheme({ id: "tech-purple" });
      });
      // Tech-purple --bg is #070611.
      // Tech-purple --bg 的值为 #070611.
      expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#070611");
    });

    it("persists the new preference in the injected store", () => {
      const store = createMemoryThemeStore();
      const { result } = renderWithProvider(store);
      act(() => {
        result.current.setTheme({ id: "tech-purple" });
      });
      expect(store.get()).toEqual({ id: "tech-purple" });
    });

    it("switches through all three built-in themes without error", () => {
      const { result } = renderWithProvider();
      const ids = ["graphite", "tech-purple", "nocturne"] as const;
      for (const id of ids) {
        act(() => {
          result.current.setTheme({ id });
        });
        expect(result.current.preference).toEqual({ id });
        expect(document.documentElement.dataset.theme).toBe(id);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Custom theme
  // ---------------------------------------------------------------------------

  describe("custom theme", () => {
    const customPref = {
      id: "custom" as const,
      custom: {
        background: "#010203",
        surface: "#111827",
        accent: "#8b5cf6",
        text: "#f8fafc",
      },
    };

    it("applies custom theme preference via setTheme", () => {
      const { result } = renderWithProvider();
      act(() => {
        result.current.setTheme(customPref);
      });
      expect(result.current.preference).toEqual(customPref);
    });

    it("sets data-theme=custom on document.documentElement", () => {
      const { result } = renderWithProvider();
      act(() => {
        result.current.setTheme(customPref);
      });
      expect(document.documentElement.dataset.theme).toBe("custom");
    });

    it("sets --bg CSS variable to custom background color", () => {
      const { result } = renderWithProvider();
      act(() => {
        result.current.setTheme(customPref);
      });
      expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#010203");
    });

    it("sets --accent CSS variable to custom accent color", () => {
      const { result } = renderWithProvider();
      act(() => {
        result.current.setTheme(customPref);
      });
      expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#8b5cf6");
    });

    it("clears custom theme by switching back to a built-in", () => {
      const { result } = renderWithProvider();
      act(() => {
        result.current.setTheme(customPref);
      });
      act(() => {
        result.current.setTheme({ id: "nocturne" });
      });
      expect(result.current.preference).toEqual({ id: "nocturne" });
      expect(document.documentElement.dataset.theme).toBe("nocturne");
    });

    it("rejects a partial custom theme (missing fields) and falls back to nocturne", () => {
      const { result } = renderWithProvider();
      act(() => {
        // Missing 'text' — normalizeThemePreference should reject and return nocturne.
        // 缺少 'text' 字段 — normalizeThemePreference 应拒绝并回退到 nocturne.
        result.current.setTheme({
          id: "custom" as const,
          custom: { background: "#010203", surface: "#111827", accent: "#8b5cf6", text: "" },
        });
      });
      expect(result.current.preference).toEqual({ id: "nocturne" });
    });
  });

  // ---------------------------------------------------------------------------
  // Store pre-populated (preference survives provider mount)
  // ---------------------------------------------------------------------------

  describe("when store is pre-populated", () => {
    it("reads initial graphite preference from the store on mount", () => {
      const store = createMemoryThemeStore({ id: "graphite" });
      const { result } = renderWithProvider(store);
      expect(result.current.preference).toEqual({ id: "graphite" });
      expect(document.documentElement.dataset.theme).toBe("graphite");
    });
  });
});
