// Categories filter selection store. Module-level zustand + MMKV per-server persistence.
// 分类筛选选择 store. 模块级 zustand + 按服务器命名空间的 MMKV 持久化.

import { create } from "zustand";

import { getNamespacedStorage, readJSON, writeJSON } from "@/storage/mmkv";

const STORAGE_KEY = "kmtv:categoriesSelection";

interface PersistedShape {
  groupKey: string | null;
  subName: string | null;
  regionName: string | null;
}

/**
 * CategoriesState — selection + active server scope + actions.
 * CategoriesState — 选择 + 当前服务器作用域 + actions.
 */
export interface CategoriesState extends PersistedShape {
  serverURL: string | null;
  hydrate: (serverURL: string) => void;
  selectGroup: (key: string) => void;
  selectSub: (name: string) => void;
  selectRegion: (name: string) => void;
  resetAll: () => void;
}

const empty: PersistedShape = { groupKey: null, subName: null, regionName: null };

function persist(serverURL: string | null, shape: PersistedShape): void {
  if (!serverURL) return;
  const storage = getNamespacedStorage(serverURL);
  writeJSON<PersistedShape>(storage, STORAGE_KEY, shape);
}

/**
 * Module-level zustand store mirroring web's categoriesStore but persisted to MMKV per server.
 * 模块级 zustand store, 接口与 web 一致, 按服务器命名空间持久化到 MMKV.
 *
 * Persistence semantics:
 *   - hydrate(serverURL) MUST be called before reads; it swaps the active scope and seeds state.
 *   - Mutations write through to the active server's MMKV slot synchronously.
 *   - Switching scope mid-session is supported (calling hydrate with a different URL re-seeds).
 * 持久化语义:
 *   - 读前必须先 hydrate(serverURL), 用于切换作用域并初始化状态.
 *   - mutation 同步写入当前服务器的 MMKV slot.
 *   - 支持会话中切换 scope (传入不同 URL 调用 hydrate 即可重新加载).
 */
export const categoriesStore = create<CategoriesState>((set, get) => ({
  ...empty,
  serverURL: null,

  hydrate: (serverURL) => {
    const storage = getNamespacedStorage(serverURL);
    const loaded = readJSON<PersistedShape>(storage, STORAGE_KEY, empty);
    set({ ...loaded, serverURL });
  },

  selectGroup: (key) => {
    if (key === get().groupKey) return;
    const next: PersistedShape = { groupKey: key, subName: null, regionName: null };
    set(next);
    persist(get().serverURL, next);
  },

  selectSub: (name) => {
    set({ subName: name });
    persist(get().serverURL, { groupKey: get().groupKey, subName: name, regionName: get().regionName });
  },

  selectRegion: (name) => {
    set({ regionName: name });
    persist(get().serverURL, { groupKey: get().groupKey, subName: get().subName, regionName: name });
  },

  resetAll: () => {
    set({ ...empty });
    persist(get().serverURL, empty);
  },
}));
