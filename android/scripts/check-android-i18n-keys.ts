#!/usr/bin/env tsx
// Verify Android i18n namespaces have matching keys across zh + en.
// 校验 Android i18n namespace 在 zh 与 en 之间 key 平价.

import enAdmin from "../src/i18n/locales/en/admin";
import enBootstrap from "../src/i18n/locales/en/bootstrap";
import enCategories from "../src/i18n/locales/en/categories";
import enCommon from "../src/i18n/locales/en/common";
import enFavorites from "../src/i18n/locales/en/favorites";
import enHome from "../src/i18n/locales/en/home";
import enNav from "../src/i18n/locales/en/nav";
import enPlayback from "../src/i18n/locales/en/playback";
import enProfile from "../src/i18n/locales/en/profile";
import enSearch from "../src/i18n/locales/en/search";
import zhAdmin from "../src/i18n/locales/zh/admin";
import zhBootstrap from "../src/i18n/locales/zh/bootstrap";
import zhCategories from "../src/i18n/locales/zh/categories";
import zhCommon from "../src/i18n/locales/zh/common";
import zhFavorites from "../src/i18n/locales/zh/favorites";
import zhHome from "../src/i18n/locales/zh/home";
import zhNav from "../src/i18n/locales/zh/nav";
import zhPlayback from "../src/i18n/locales/zh/playback";
import zhProfile from "../src/i18n/locales/zh/profile";
import zhSearch from "../src/i18n/locales/zh/search";

const locales = {
  zh: { common: zhCommon, nav: zhNav, bootstrap: zhBootstrap, home: zhHome, categories: zhCategories, search: zhSearch,
        playback: zhPlayback, favorites: zhFavorites, profile: zhProfile, admin: zhAdmin },
  en: { common: enCommon, nav: enNav, bootstrap: enBootstrap, home: enHome, categories: enCategories, search: enSearch,
        playback: enPlayback, favorites: enFavorites, profile: enProfile, admin: enAdmin },
} as const;

function flatten(value: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") {
      keys.push(...flatten(v as Record<string, unknown>, next));
    } else {
      keys.push(next);
    }
  }
  return keys.sort();
}

let failed = false;
for (const ns of Object.keys(locales.zh) as Array<keyof typeof locales.zh>) {
  const zhKeys = flatten(locales.zh[ns] as unknown as Record<string, unknown>);
  const enKeys = flatten(locales.en[ns] as unknown as Record<string, unknown>);
  const onlyInZh = zhKeys.filter((k) => !enKeys.includes(k));
  const onlyInEn = enKeys.filter((k) => !zhKeys.includes(k));
  if (onlyInZh.length || onlyInEn.length) {
    failed = true;
    console.error(`namespace ${ns}:`);
    if (onlyInZh.length) console.error(`  only in zh: ${onlyInZh.join(", ")}`);
    if (onlyInEn.length) console.error(`  only in en: ${onlyInEn.join(", ")}`);
  }
}

if (failed) {
  process.exit(1);
}
console.log("android i18n keys OK");
