import { describe, expect, test } from "vitest";

import enAccount from "../locales/en/account";
import enAdmin from "../locales/en/admin";
import enAuth from "../locales/en/auth";
import enCommon from "../locales/en/common";
import enErrors from "../locales/en/errors";
import enNav from "../locales/en/nav";
import enViewer from "../locales/en/viewer";
import zhAccount from "../locales/zh/account";
import zhAdmin from "../locales/zh/admin";
import zhAuth from "../locales/zh/auth";
import zhCommon from "../locales/zh/common";
import zhErrors from "../locales/zh/errors";
import zhNav from "../locales/zh/nav";
import zhViewer from "../locales/zh/viewer";

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

const namespaces = [
  { name: "common", zh: zhCommon, en: enCommon },
  { name: "nav", zh: zhNav, en: enNav },
  { name: "auth", zh: zhAuth, en: enAuth },
  { name: "viewer", zh: zhViewer, en: enViewer },
  { name: "account", zh: zhAccount, en: enAccount },
  { name: "admin", zh: zhAdmin, en: enAdmin },
  { name: "errors", zh: zhErrors, en: enErrors },
] as const;

describe("i18n integrity", () => {
  for (const ns of namespaces) {
    test(`${ns.name} namespace parity`, () => {
      expect(flatten(enAccount as never), `placeholder reference for ${ns.name}`).toBeTruthy();
      expect(flatten(ns.en)).toStrictEqual(flatten(ns.zh));
    });
  }
});
