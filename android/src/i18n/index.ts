// i18next setup — wires locales and exposes initI18n(language).
// i18next 初始化, 装配 locale 并暴露 initI18n(language).

import i18next, { type i18n as I18nInstance } from "i18next";
import { initReactI18next } from "react-i18next";

import enAdmin from "./locales/en/admin";
import enBootstrap from "./locales/en/bootstrap";
import enCategories from "./locales/en/categories";
import enCommon from "./locales/en/common";
import enFavorites from "./locales/en/favorites";
import enHome from "./locales/en/home";
import enNav from "./locales/en/nav";
import enPlayback from "./locales/en/playback";
import enProfile from "./locales/en/profile";
import enSearch from "./locales/en/search";
import zhAdmin from "./locales/zh/admin";
import zhBootstrap from "./locales/zh/bootstrap";
import zhCategories from "./locales/zh/categories";
import zhCommon from "./locales/zh/common";
import zhFavorites from "./locales/zh/favorites";
import zhHome from "./locales/zh/home";
import zhNav from "./locales/zh/nav";
import zhPlayback from "./locales/zh/playback";
import zhProfile from "./locales/zh/profile";
import zhSearch from "./locales/zh/search";

const resources = {
  en: { common: enCommon, nav: enNav, bootstrap: enBootstrap, home: enHome, categories: enCategories,
        search: enSearch, playback: enPlayback, favorites: enFavorites, profile: enProfile, admin: enAdmin },
  zh: { common: zhCommon, nav: zhNav, bootstrap: zhBootstrap, home: zhHome, categories: zhCategories,
        search: zhSearch, playback: zhPlayback, favorites: zhFavorites, profile: zhProfile, admin: zhAdmin },
} as const;

/**
 * Supported UI languages mirror the web client.
 * 支持的 UI 语言与 web 端一致.
 */
export type Lang = "en" | "zh";

/**
 * Initialise i18next with the embedded resources and the chosen language.
 * 使用内嵌资源与指定语言初始化 i18next.
 */
export async function initI18n(lang: Lang): Promise<I18nInstance> {
  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({
      compatibilityJSON: "v4",
      lng: lang,
      fallbackLng: "en",
      ns: ["common", "nav", "bootstrap", "home", "categories", "search", "playback", "favorites", "profile", "admin"],
      defaultNS: "common",
      resources,
      interpolation: { escapeValue: false },
      returnNull: false,
    });
  } else if (i18next.language !== lang) {
    await i18next.changeLanguage(lang);
  }
  return i18next;
}
