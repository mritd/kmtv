// Language store — global (not per-server). UI language persists across servers.
// 语言 store — 全局 (非按 server 隔离), UI 语言跨服务器持续.

import { create } from "zustand";

import type { Lang } from "../i18n";
import { getNamespacedStorage, readJSON, writeJSON } from "../storage/mmkv";

const STORAGE = "settings";
const KEY = "kmtv:lang";

interface I18nState {
  lang: Lang;
  setLang: (v: Lang) => void;
  hydrate: () => void;
}

function isLang(v: unknown): v is Lang {
  return v === "en" || v === "zh";
}

/**
 * Zustand store for the user's UI language.
 * 承载用户 UI 语言的 zustand store.
 */
export const useI18nStore = create<I18nState>((set) => ({
  lang: "en",
  setLang: (v) => {
    writeJSON(getNamespacedStorage(STORAGE), KEY, { lang: v });
    set({ lang: v });
  },
  hydrate: () => {
    const stored = readJSON<{ lang: unknown }>(getNamespacedStorage(STORAGE), KEY, { lang: "en" });
    set({ lang: isLang(stored.lang) ? stored.lang : "en" });
  },
}));
