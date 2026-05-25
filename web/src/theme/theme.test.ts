/**
 * Tests for themes.ts — built-in theme catalogue, normalizeThemePreference, applyThemeVariables,
 * and createMemoryThemeStore.
 *
 * themes.ts 测试 — 内置主题目录, normalizeThemePreference, applyThemeVariables 及 createMemoryThemeStore.
 */

import { describe, expect, it } from "vitest";

import { applyThemeVariables, builtInThemes, createMemoryThemeStore, defaultThemePreference, normalizeThemePreference } from "./themes";

const custom = {
  id: "custom" as const,
  custom: {
    background: "#010203",
    surface: "#111827",
    accent: "#8b5cf6",
    text: "#f8fafc",
  },
};

describe("theme model", () => {
  it("keeps Nocturne Blue as the default built-in theme", () => {
    expect(builtInThemes[0].id).toBe("nocturne");
    expect(builtInThemes[0].label).toBe("Nocturne Blue");
  });

  it("exposes all three built-in themes with correct ids", () => {
    const ids = builtInThemes.map((t) => t.id);
    expect(ids).toContain("nocturne");
    expect(ids).toContain("graphite");
    expect(ids).toContain("tech-purple");
  });

  it("exports the nocturne default preference", () => {
    expect(defaultThemePreference).toEqual({ id: "nocturne" });
  });

  it("normalizes unknown preferences to nocturne", () => {
    expect(normalizeThemePreference({ id: "missing" }).id).toBe("nocturne");
    expect(normalizeThemePreference(custom)).toEqual(custom);
  });

  it("normalizes null to default (nocturne)", () => {
    // Guards the !value branch in normalizeThemePreference.
    // 覆盖 normalizeThemePreference 中的 !value 分支.
    expect(normalizeThemePreference(null)).toEqual({ id: "nocturne" });
  });

  it("normalizes non-object primitives to default (nocturne)", () => {
    // Guards the typeof !== "object" branch.
    // 覆盖 typeof !== "object" 分支.
    expect(normalizeThemePreference(42)).toEqual({ id: "nocturne" });
    expect(normalizeThemePreference("graphite")).toEqual({ id: "nocturne" });
  });

  it("persists theme preferences in a store", () => {
    const store = createMemoryThemeStore();
    expect(store.get().id).toBe("nocturne");
    store.set({ id: "tech-purple" });
    expect(store.get().id).toBe("tech-purple");
    store.set(custom);
    expect(store.get()).toEqual(custom);
  });

  it("maps selected themes to semantic CSS variables", () => {
    const graphiteVariables = applyThemeVariables({ id: "graphite" });
    expect(graphiteVariables["--ambient"]).toBe("rgba(203, 213, 225, 0.18)");
    expect(graphiteVariables["--ambient"]).not.toContain("225, 29, 72");

    const variables = applyThemeVariables({ id: "nocturne" });
    expect(variables["--bg"]).toBe("#05070d");
    expect(variables["--accent"]).toBe("#bfdbfe");
    expect(variables["--ambient"]).toBe("rgba(96, 165, 250, 0.2)");
    expect(variables["--danger"]).toBeTruthy();

    const purpleVariables = applyThemeVariables({ id: "tech-purple" });
    expect(purpleVariables["--ambient"]).toBe("rgba(168, 85, 247, 0.2)");

    const customVariables = applyThemeVariables(custom);
    expect(customVariables["--bg"]).toBe("#010203");
    expect(customVariables["--surface"]).toBe("#111827");
    expect(customVariables["--accent"]).toBe("#8b5cf6");
    expect(customVariables["--ambient"]).toBe("color-mix(in srgb, var(--accent) 20%, transparent)");
    expect(customVariables["--text"]).toBe("#f8fafc");
  });
});
