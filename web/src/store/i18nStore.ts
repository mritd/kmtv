/**
 * i18nStore — device-level language preference with localStorage persistence.
 * i18nStore — 带 localStorage 持久化的设备级语言偏好 store.
 *
 * Responsibilities / 职责:
 *   - Hold the active UI language ("zh" | "en") — 持有当前 UI 语言
 *   - Persist the preference under the "kmtv.lang" key via Zustand persist middleware — 通过 Zustand persist 中间件持久化至 "kmtv.lang" key
 *   - Expose setLang() for the language switcher UI — 为语言切换 UI 暴露 setLang()
 *   - Expose reset() to restore the default ("zh") without clearing persistence — 暴露 reset() 恢复默认语言 ("zh")
 *
 * State shape / 状态结构:
 *   lang: Lang  — active language identifier
 *
 * Actions / 动作:
 *   setLang(lang) — update the active language and persist it
 *   reset()       — restore the default language ("zh")
 *
 * Persistence / 持久化:
 *   localStorage key: "kmtv.lang"  (TIER 4 LOCKED — do NOT rename)
 *   localStorage key: "kmtv.lang"  (Tier 4 锁定 — 不得重命名)
 *
 * Callers / 调用方:
 *   account/ThemeSettings.tsx   (language switcher; calls setLang)
 *   i18n/index.ts               (reads initial lang on boot; subscribes via useI18nStore)
 *   app/AppLayout.tsx           (reads lang to drive i18next.changeLanguage)
 *   test/setup.ts               (calls setState({ lang: "zh" }) in beforeEach to isolate tests)
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Lang — supported locale identifiers.
 * Lang — 支持的语言标识.
 *
 * "zh" = Simplified Chinese (default); "en" = English.
 * "zh" = 简体中文 (默认); "en" = 英文.
 */
export type Lang = "zh" | "en";

// I18nState is kept private; callers access the store shape via the useI18nStore hook.
// I18nState 为内部接口, 调用方通过 useI18nStore hook 访问 store 形态.
interface I18nState {
  lang: Lang;
  setLang(lang: Lang): void;
  reset(): void;
}

/**
 * useI18nStore — React hook store that persists the device-level language preference.
 * useI18nStore — 持久化设备级语言偏好的 React hook store.
 *
 * Using `create` (with React hooks) rather than `createStore` (vanilla) because the language
 * preference is consumed exclusively by React components and the i18n boot sequence.
 * 使用 create (React hook 版) 而非 createStore (vanilla), 因为语言偏好仅供 React 组件和 i18n 启动序列使用.
 *
 * The persist middleware writes to localStorage["kmtv.lang"] automatically.
 * persist 中间件自动将数据写入 localStorage["kmtv.lang"].
 */
export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      lang: "zh",
      setLang: (lang) => set({ lang }),
      reset: () => set({ lang: "zh" }),
    }),
    {
      // TIER 4 LOCKED — renaming this key would silently lose every user's saved language preference.
      // Tier 4 锁定 — 重命名此 key 会静默丢失所有用户已保存的语言偏好.
      name: "kmtv.lang",
    },
  ),
);
