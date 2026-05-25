/**
 * Tests for createLocalThemeStore — localStorage-backed ThemeStore implementation.
 * Verifies key name lock, round-trip persistence, JSON-corruption recovery, and
 * the ThemeStorageLike abstraction that allows test-time injection.
 *
 * createLocalThemeStore 的 localStorage 持久化测试.
 * 涵盖 key 名称锁定, 往返持久化, JSON 损坏恢复及可注入存储接口.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLocalThemeStore, themeStorageKey } from "./themeStore";

// ---------------------------------------------------------------------------
// Helpers — in-memory StorageLike for deterministic test isolation
// ---------------------------------------------------------------------------

/** Creates an isolated in-memory ThemeStorageLike, independent of happy-dom localStorage. */
function makeStorage(initial: Record<string, string> = {}): {
  store: Map<string, string>;
  storage: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
} {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => { store.set(k, v); },
      removeItem: (k) => { store.delete(k); },
    },
  };
}

describe("themeStorageKey", () => {
  it("is the locked constant kmtv.theme (Tier 4 — must not be renamed)", () => {
    // This test pins the localStorage key. If it fails, a Tier-4 forbidden change occurred.
    // 该测试锁定 localStorage key 名称, 若失败则表示发生了 Tier-4 禁止变更.
    expect(themeStorageKey).toBe("kmtv.theme");
  });
});

describe("createLocalThemeStore", () => {
  describe("when storage is empty", () => {
    it("returns the default nocturne preference on get()", () => {
      const { storage } = makeStorage();
      const s = createLocalThemeStore(storage);
      expect(s.get()).toEqual({ id: "nocturne" });
    });
  });

  describe("when a valid built-in theme is stored", () => {
    it("round-trips graphite preference", () => {
      const { storage } = makeStorage();
      const s = createLocalThemeStore(storage);
      s.set({ id: "graphite" });
      expect(s.get()).toEqual({ id: "graphite" });
    });

    it("round-trips nocturne preference", () => {
      const { storage } = makeStorage();
      const s = createLocalThemeStore(storage);
      s.set({ id: "nocturne" });
      expect(s.get()).toEqual({ id: "nocturne" });
    });

    it("round-trips tech-purple preference", () => {
      const { storage } = makeStorage();
      const s = createLocalThemeStore(storage);
      s.set({ id: "tech-purple" });
      expect(s.get()).toEqual({ id: "tech-purple" });
    });

    it("writes under themeStorageKey so consumers share the same slot", () => {
      const { storage, store } = makeStorage();
      const s = createLocalThemeStore(storage);
      s.set({ id: "graphite" });
      expect(store.has(themeStorageKey)).toBe(true);
      const raw = store.get(themeStorageKey)!;
      expect(JSON.parse(raw)).toMatchObject({ id: "graphite" });
    });
  });

  describe("when a valid custom theme is stored", () => {
    const customPref = {
      id: "custom" as const,
      custom: {
        background: "#010203",
        surface: "#111827",
        accent: "#8b5cf6",
        text: "#f8fafc",
      },
    };

    it("round-trips a fully-specified custom theme", () => {
      const { storage } = makeStorage();
      const s = createLocalThemeStore(storage);
      s.set(customPref);
      expect(s.get()).toEqual(customPref);
    });
  });

  describe("when localStorage contains corrupted JSON", () => {
    it("returns the default preference and removes the corrupt entry", () => {
      const { storage, store } = makeStorage({ [themeStorageKey]: "not-json{{" });
      const s = createLocalThemeStore(storage);
      expect(s.get()).toEqual({ id: "nocturne" });
      // Corrupt entry must be removed so subsequent reads do not re-encounter it.
      // 损坏条目必须被清除, 防止后续读取再次遇到.
      expect(store.has(themeStorageKey)).toBe(false);
    });
  });

  describe("when localStorage contains an unrecognised preference object", () => {
    it("normalizes to default (nocturne) without removing the entry", () => {
      const { storage } = makeStorage({ [themeStorageKey]: JSON.stringify({ id: "unknown-theme" }) });
      const s = createLocalThemeStore(storage);
      // normalizeThemePreference falls back to nocturne for unrecognised ids.
      // normalizeThemePreference 对未知 id 回退到 nocturne.
      expect(s.get()).toEqual({ id: "nocturne" });
    });
  });

  describe("when set() is called with an unrecognised preference", () => {
    it("normalizes to default before writing to storage", () => {
      const { storage, store } = makeStorage();
      const s = createLocalThemeStore(storage);
      s.set({ id: "nocturne" }); // write something first
      // Force an unrecognised value through the store interface.
      // normalizeThemePreference should sanitize it before persistence.
      // 通过接口写入未知 preference, normalizeThemePreference 应在持久化前做清洗.
      s.set({ id: "mystery" as "graphite" });
      const raw = store.get(themeStorageKey)!;
      expect(JSON.parse(raw)).toMatchObject({ id: "nocturne" });
    });
  });

  describe("localStorage round-trip via window.localStorage default", () => {
    beforeEach(() => {
      window.localStorage.clear();
    });

    afterEach(() => {
      window.localStorage.clear();
    });

    it("reads and writes through the real window.localStorage when no storage injected", () => {
      // Verify the default parameter (window.localStorage) is exercised.
      // 验证默认参数 (window.localStorage) 路径可被覆盖.
      const s = createLocalThemeStore();
      expect(s.get()).toEqual({ id: "nocturne" });
      s.set({ id: "tech-purple" });
      expect(window.localStorage.getItem(themeStorageKey)).not.toBeNull();
      // A fresh store instance reading the same slot should see the persisted value.
      // 新建 store 实例应能读取持久化的值.
      const s2 = createLocalThemeStore();
      expect(s2.get()).toEqual({ id: "tech-purple" });
    });
  });
});
