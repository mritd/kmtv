/**
 * categoriesStore — browse-page filter selection that survives route unmounts.
 * categoriesStore — 浏览页的筛选选择, 在路由卸载时保持.
 *
 * Responsibilities / 职责:
 *   - Hold the user's selected category/sub-category/region as plain identifiers — 以纯标识符保存用户选中的分类/子分类/地区
 *   - Reset sub-category and region when the top-level category changes (mirrors iOS selectGroup) — 切换顶层分类时重置子分类与地区 (与 iOS selectGroup 一致)
 *   - Provide reset() so navigating away and back (or logging out) starts clean when needed — 提供 reset(), 在需要时让离开后返回 (或登出) 从干净状态开始
 *
 * Why a store and not local state / 为何用 store 而非组件本地 state:
 *   The page unmounts on navigation (AnimatePresence mode="wait"). Local useState would reset the
 *   filters every time the user opens an item and presses Back. A module-level store preserves the
 *   selection across remounts within a session, matching the established searchStore/detailStore pattern.
 *   页面在导航时卸载 (AnimatePresence mode="wait"). 本地 useState 会在用户每次打开条目并返回时重置筛选.
 *   模块级 store 在会话内跨重挂保留选择, 与既有的 searchStore/detailStore 模式一致.
 *
 * State shape / 状态结构:
 *   groupKey    — selected CategoryGroup.key (null → resolves to first group)
 *   subName     — selected SubCategory.name  (null → resolves to first sub)
 *   regionName  — selected Region.name       (null → resolves to first region)
 *
 * Actions / 动作:
 *   selectGroup(key)   — set group, reset sub + region (no-op if key unchanged)
 *   selectSub(name)    — set sub-category
 *   selectRegion(name) — set region
 *   reset()            — clear all selections back to null
 *
 * Callers / 调用方:
 *   viewer/categories/CategoriesPage.tsx (reads selection; calls selectGroup/selectSub/selectRegion)
 *   test/setup.ts (reset() in beforeEach)
 */

import { createStore } from "zustand/vanilla";

import type { CategorySelection } from "@/viewer/categories/categoryFilter";

/**
 * CategoriesState — full state + action contract of categoriesStore.
 * CategoriesState — categoriesStore 的完整状态与 action 接口.
 */
export interface CategoriesState extends CategorySelection {
  selectGroup(key: string): void;
  selectSub(name: string): void;
  selectRegion(name: string): void;
  reset(): void;
}

// initialState is extracted so reset() can spread it atomically.
// 提取 initialState 以便 reset() 原子地展开.
const initialState: CategorySelection = {
  groupKey: null,
  subName: null,
  regionName: null,
};

/**
 * categoriesStore — vanilla Zustand store (consumed in React via `useStore(categoriesStore, selector)`).
 * categoriesStore — 原生 Zustand store (在 React 中通过 `useStore(categoriesStore, selector)` 消费).
 */
export const categoriesStore = createStore<CategoriesState>()((set, get) => ({
  ...initialState,

  selectGroup: (key) => {
    // No-op when re-selecting the current group so the user's sub/region choice is preserved.
    // 重选当前分组时不操作, 以保留用户的子分类/地区选择.
    if (key === get().groupKey) return;
    // Switching group clears sub + region; categoryFilter then resolves them to the new group's
    // first options (the old names no longer exist there).
    // 切换分组会清空子分类与地区; categoryFilter 随后将其解析到新分组的首个选项 (旧名称已不存在).
    set({ groupKey: key, subName: null, regionName: null });
  },

  selectSub: (name) => set({ subName: name }),

  selectRegion: (name) => set({ regionName: name }),

  reset: () => set({ ...initialState }),
}));
