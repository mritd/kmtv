#!/usr/bin/env tsx
// check-i18n-keys verifies every locale has the same set of keys per namespace.
// check-i18n-keys
// 校验每个 namespace 下各语言资源拥有相同 key 集.

import enAccount from "../web/src/i18n/locales/en/account";
import enAdmin from "../web/src/i18n/locales/en/admin";
import enAuth from "../web/src/i18n/locales/en/auth";
import enCommon from "../web/src/i18n/locales/en/common";
import enErrors from "../web/src/i18n/locales/en/errors";
import enNav from "../web/src/i18n/locales/en/nav";
import enViewer from "../web/src/i18n/locales/en/viewer";
import zhAccount from "../web/src/i18n/locales/zh/account";
import zhAdmin from "../web/src/i18n/locales/zh/admin";
import zhAuth from "../web/src/i18n/locales/zh/auth";
import zhCommon from "../web/src/i18n/locales/zh/common";
import zhErrors from "../web/src/i18n/locales/zh/errors";
import zhNav from "../web/src/i18n/locales/zh/nav";
import zhViewer from "../web/src/i18n/locales/zh/viewer";

const locales = {
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
  const zhKeys = flatten(locales.zh[ns]);
  const enKeys = flatten(locales.en[ns]);
  const onlyInZh = zhKeys.filter((k) => !enKeys.includes(k));
  const onlyInEn = enKeys.filter((k) => !zhKeys.includes(k));
  if (onlyInZh.length || onlyInEn.length) {
    failed = true;
    console.error(`[${ns}] mismatch`);
    if (onlyInZh.length) console.error("  zh only:", onlyInZh);
    if (onlyInEn.length) console.error("  en only:", onlyInEn);
  }
}

if (failed) {
  process.exit(1);
} else {
  console.log("i18n key parity OK");
}
