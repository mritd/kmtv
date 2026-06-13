// Theme override store — global (not per-server) since UI theme outlives server switches.
// 主题覆盖 store — 全局 (非按 server 隔离), 主题偏好跨服务器持续.

import { create } from "zustand";

import type { ThemeOverride } from "../designSystem/ThemeProvider";
import { getNamespacedStorage, readJSON, writeJSON } from "../storage/mmkv";

const STORAGE = "settings";
const KEY = "kmtv:theme";

interface ThemeState {
  override: ThemeOverride;
  setOverride: (v: ThemeOverride) => void;
  hydrate: () => void;
}

function isThemeOverride(v: unknown): v is ThemeOverride {
  return v === "system" || v === "light" || v === "dark";
}

/**
 * Zustand store backing the user's theme override choice.
 * 承载用户主题覆盖选择的 zustand store.
 */
export const useThemeStore = create<ThemeState>((set) => ({
  override: "system",
  setOverride: (v) => {
    writeJSON(getNamespacedStorage(STORAGE), KEY, { override: v });
    set({ override: v });
  },
  hydrate: () => {
    const stored = readJSON<{ override: unknown }>(getNamespacedStorage(STORAGE), KEY, { override: "system" });
    set({ override: isThemeOverride(stored.override) ? stored.override : "system" });
  },
}));
