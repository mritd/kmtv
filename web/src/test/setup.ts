/**
 * test/setup.ts - shared Vitest environment initialization and state isolation.
 *
 * test/setup.ts - 共享 Vitest 环境初始化与状态隔离.
 *
 * Responsibilities / 职责:
 *   - Install a deterministic localStorage fallback before application modules load
 *
 *     - 在应用模块加载前安装确定性的 localStorage fallback
 *
 *   - Initialize i18n and reset shared stores around every test
 *
 *     - 初始化 i18n 并在每个测试前后重置共享 store
 *
 * Callers / 调用方:
 *   vitest.config.ts setupFiles - vitest.config.ts setupFiles
 */

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
function installLocalStorageFallback(): void {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
}

installLocalStorageFallback();

// Initialize i18n exactly once for tests;
// AppLayout and other components use useTranslation.
//
// 测试中初始化 i18n, 让 AppLayout 等组件可使用 useTranslation.
await import("@/i18n");
const { default: i18n } = await import("@/i18n");
const { adminModalStore } = await import("@/store/adminModalStore");
const { categoriesStore } = await import("@/store/categoriesStore");
const { detailStore } = await import("@/store/detailStore");
const { searchStore } = await import("@/store/searchStore");
const { useI18nStore } = await import("@/store/i18nStore");

beforeEach(() => {
  // Reset language to the default before each test so a previous test's switch does not leak.
  //
  // 每个测试前重置语言, 避免上一个测试切换语言对后续造成污染.
  useI18nStore.setState({ lang: "zh" });
  if (i18n.language !== "zh") {
    void i18n.changeLanguage("zh");
  }
  // Reset module-level zustand stores so SearchPage and DetailPage state do not leak across tests.
  //
  // 重置模块级 zustand store, 防止 SearchPage/DetailPage 状态跨测试污染.
  searchStore.getState().resetAll();
  detailStore.getState().resetAll();
  adminModalStore.getState().close();
  categoriesStore.getState().reset();
});

afterEach(() => {
  cleanup();
});
