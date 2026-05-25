// i18n bootstrap — initialises the i18next singleton and wires it to the Zustand language store.
// Callers: production — imported once as a side-effect in src/main.tsx before React mounts.
//          test     — src/test/setup.ts also imports @/i18n so every test suite has a live i18n instance.
// Excluded from vitest coverage because the init() call fires as a module-level side-effect on
// import; every test suite that imports anything i18n-aware exercises this indirectly.
//
// Init options summary:
//   resources      — all namespaces bundled at build time; no HTTP backend needed.
//   lng            — initial language read from the persisted Zustand store (localStorage).
//   fallbackLng    — "zh" (Chinese), so missing English keys fall back to Chinese, not raw keys.
//   defaultNS      — "common"; keys without a namespace prefix resolve from the common bundle.
//   interpolation  — escapeValue: false because React already escapes JSX output.
//   returnNull     — false; prevents null being returned when a resource value is explicitly null.
//                   Missing-key fallback (returning the key string) is i18next's default behaviour.
//
// Language detection order: Zustand store (i18nStore.lang) wins on boot.
// A store subscription installed below keeps i18next in sync when the user switches language
// at runtime; the reverse direction (i18next → store) is not needed.
//
// i18n 引导 — 初始化 i18next 单例并关联 Zustand 语言 store.
// 调用方: 生产环境 — 仅在 src/main.tsx 中作为副作用 import 一次, 先于 React 挂载.
//          测试环境 — src/test/setup.ts 也 import @/i18n, 让每个测试套件都有活跃的 i18n 实例.
// 排除在 vitest 覆盖率之外, 因为 init() 以模块级副作用形式执行;
// 每个导入 i18n 相关内容的测试套件都会间接触发此模块.
//
// 初始化选项说明:
//   resources      — 所有命名空间在构建时打包, 无需 HTTP 后端.
//   lng            — 初始语言从持久化的 Zustand store (localStorage) 读取.
//   fallbackLng    — "zh" (中文), 缺少英文 key 时回退中文, 而非显示裸 key.
//   defaultNS      — "common"; 无命名空间前缀的 key 从 common 包解析.
//   interpolation  — escapeValue: false, 因为 React JSX 输出已自动转义.
//   returnNull     — false; 阻止资源值显式为 null 时返回 null.
//                   缺失 key 时回退到 key 字符串是 i18next 的默认行为, 与此选项无关.
//
// 语言检测顺序: 启动时以 Zustand store (i18nStore.lang) 为准.
// 下方安装的 store 订阅在运行时用户切换语言时将 i18next 保持同步;
// 反向同步 (i18next → store) 不需要.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { useI18nStore } from "@/store/i18nStore";

import enAccount from "./locales/en/account";
import enAdmin from "./locales/en/admin";
import enAuth from "./locales/en/auth";
import enCommon from "./locales/en/common";
import enErrors from "./locales/en/errors";
import enNav from "./locales/en/nav";
import enViewer from "./locales/en/viewer";
import zhAccount from "./locales/zh/account";
import zhAdmin from "./locales/zh/admin";
import zhAuth from "./locales/zh/auth";
import zhCommon from "./locales/zh/common";
import zhErrors from "./locales/zh/errors";
import zhNav from "./locales/zh/nav";
import zhViewer from "./locales/zh/viewer";

// Resources object — maps each supported language to its namespace bundles.
// Supported languages: "zh" (default/fallback) and "en".
// Namespaces: common | nav | auth | viewer | account | admin | errors.
// The zh locale is the canonical source; en is the secondary locale.
//
// 资源对象 — 每个支持语言映射到其命名空间包.
// 支持语言: "zh" (默认/回退) 和 "en".
// 命名空间: common | nav | auth | viewer | account | admin | errors.
// zh 是主语言, en 是辅助语言.
const resources = {
  zh: {
    common: zhCommon,
    nav: zhNav,
    auth: zhAuth,
    viewer: zhViewer,
    account: zhAccount,
    admin: zhAdmin,
    errors: zhErrors,
  },
  en: {
    common: enCommon,
    nav: enNav,
    auth: enAuth,
    viewer: enViewer,
    account: enAccount,
    admin: enAdmin,
    errors: enErrors,
  },
};

void i18n.use(initReactI18next).init({
  resources,
  lng: useI18nStore.getState().lang,
  fallbackLng: "zh",
  defaultNS: "common",
  interpolation: { escapeValue: false },
  returnNull: false,
});

// Subscribe to language store so runtime language changes propagate to i18next.
// The guard (i18n.language !== state.lang) prevents a redundant changeLanguage call when i18next
// already reflects the desired language (e.g. after the initial boot sync above).
//
// 订阅语言 store, 将运行时语言切换同步到 i18next.
// 守卫条件 (i18n.language !== state.lang) 避免在 i18next 已匹配目标语言时重复调用 changeLanguage
// (例如启动时初始同步之后).
useI18nStore.subscribe((state) => {
  if (i18n.language !== state.lang) {
    void i18n.changeLanguage(state.lang);
  }
});

export default i18n;
