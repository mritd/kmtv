// English. 中文.
// i18next setup — wires locales and exposes initI18n(language).
// i18next 初始化, 装配 locale 并暴露 initI18n(language).

import i18next, { type i18n as I18nInstance } from "i18next";
import { initReactI18next } from "react-i18next";

import enBootstrap from "./locales/en/bootstrap";
import enCommon from "./locales/en/common";
import enNav from "./locales/en/nav";
import zhBootstrap from "./locales/zh/bootstrap";
import zhCommon from "./locales/zh/common";
import zhNav from "./locales/zh/nav";

const resources = {
  en: { common: enCommon, nav: enNav, bootstrap: enBootstrap },
  zh: { common: zhCommon, nav: zhNav, bootstrap: zhBootstrap },
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
      ns: ["common", "nav", "bootstrap"],
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
