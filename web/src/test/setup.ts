import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

// Initialize i18n exactly once for tests;
// AppLayout and other components use useTranslation.
// 测试中初始化 i18n, 让 AppLayout 等组件可使用 useTranslation.
import "@/i18n";
import i18n from "@/i18n";
import { adminModalStore } from "@/store/adminModalStore";
import { detailStore } from "@/store/detailStore";
import { searchStore } from "@/store/searchStore";
import { useI18nStore } from "@/store/i18nStore";

beforeEach(() => {
  // Reset language to the default before each test so a previous test's switch does not leak.
  // 每个测试前重置语言, 避免上一个测试切换语言对后续造成污染.
  useI18nStore.setState({ lang: "zh" });
  if (i18n.language !== "zh") {
    void i18n.changeLanguage("zh");
  }
  // Reset module-level zustand stores so SearchPage and DetailPage state do not leak across tests.
  // 重置模块级 zustand store, 防止 SearchPage/DetailPage 状态跨测试污染.
  searchStore.getState().resetAll();
  detailStore.getState().resetAll();
  adminModalStore.getState().close();
});

afterEach(() => {
  cleanup();
});
