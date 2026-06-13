// i18nStore tests — verifies default, set, hydrate, and unsupported-value fallback.
// i18nStore 测试 — 校验默认值、setLang、hydrate 与非法值回退.

import { _resetForTests } from "../storage/mmkv";
import { useI18nStore } from "./i18nStore";

describe("i18nStore", () => {
  beforeEach(() => {
    _resetForTests();
    useI18nStore.setState({ lang: "en" });
  });

  it("starts at 'en'", () => {
    expect(useI18nStore.getState().lang).toBe("en");
  });
  it("setLang updates state", () => {
    useI18nStore.getState().setLang("zh");
    expect(useI18nStore.getState().lang).toBe("zh");
  });
  it("hydrate restores persisted value", () => {
    useI18nStore.getState().setLang("zh");
    useI18nStore.setState({ lang: "en" });
    useI18nStore.getState().hydrate();
    expect(useI18nStore.getState().lang).toBe("zh");
  });
  it("hydrate falls back to 'en' for unsupported lang", () => {
    const { getNamespacedStorage, writeJSON } = require("../storage/mmkv");
    writeJSON(getNamespacedStorage("settings"), "kmtv:lang", { lang: "fr" });
    useI18nStore.getState().hydrate();
    expect(useI18nStore.getState().lang).toBe("en");
  });
  it("hydrate falls back to 'en' when storage is empty", () => {
    useI18nStore.setState({ lang: "zh" });
    useI18nStore.getState().hydrate();
    expect(useI18nStore.getState().lang).toBe("en");
  });
});
