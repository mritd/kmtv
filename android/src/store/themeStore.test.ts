// themeStore tests — verifies default, set, hydrate, and corrupted-value fallback.
// themeStore 测试 — 校验默认值、setOverride、hydrate 与非法值回退.

import { _resetForTests } from "../storage/mmkv";
import { useThemeStore } from "./themeStore";

describe("themeStore", () => {
  beforeEach(() => {
    _resetForTests();
    useThemeStore.setState({ override: "system" });
  });

  it("starts at 'system'", () => {
    expect(useThemeStore.getState().override).toBe("system");
  });
  it("setOverride updates state", () => {
    useThemeStore.getState().setOverride("dark");
    expect(useThemeStore.getState().override).toBe("dark");
  });
  it("hydrate reads the persisted value", () => {
    useThemeStore.getState().setOverride("light");
    useThemeStore.setState({ override: "system" });
    useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().override).toBe("light");
  });
  it("rejects unknown overrides on hydrate", () => {
    const { getNamespacedStorage, writeJSON } = require("../storage/mmkv");
    writeJSON(getNamespacedStorage("settings"), "kmtv:theme", { override: "bogus" });
    useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().override).toBe("system");
  });
  it("hydrate falls back to 'system' when storage is empty", () => {
    useThemeStore.setState({ override: "dark" });
    useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().override).toBe("system");
  });
});
