/**
 * railLabel.test.ts — unit tests for the translateRailName pure helper.
 * railLabel.test.ts — translateRailName 纯函数的单元测试.
 *
 * Strategy / 策略:
 *   Uses the real i18next instance (initialised in src/test/setup.ts) in "zh" locale so
 *   tests exercise the actual translation table rather than mocking it. English locale
 *   tests switch language explicitly and restore it afterward.
 *   使用 src/test/setup.ts 初始化的真实 i18next 实例 (zh 语言), 测试实际翻译表而非 mock.
 *   英文语言测试显式切换语言并在之后还原.
 *
 * Branches covered / 覆盖分支:
 *   1. Known rail name (zh) — returns translated label (same string for zh locale).
 *      已知 rail 名 (zh) — 返回翻译后标签 (zh locale 下与原始名相同).
 *   2. Known rail name (en) — returns English translated label.
 *      已知 rail 名 (en) — 返回英文翻译标签.
 *   3. Unknown rail name — falls back to the raw name unchanged.
 *      未知 rail 名 — 退回原始名称不变.
 *   4. Empty string — falls back to empty string (no crash, no key exposure).
 *      空字符串 — 退回空字符串 (不崩溃, 不暴露 key).
 *   5. Name with special characters — falls back gracefully, no interpolation risk.
 *      含特殊字符的名称 — 优雅退回, 无插值风险.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import i18n from "@/i18n";

import { translateRailName } from "./railLabel";

// Helper to get the t function bound to the "viewer" namespace.
// 获取绑定到 "viewer" namespace 的 t 函数的辅助函数.
function getT() {
  return i18n.getFixedT(null, "viewer") as Parameters<typeof translateRailName>[0];
}

describe("translateRailName", () => {
  describe("when language is zh (default)", () => {
    it("returns the Chinese label for a known rail name", () => {
      // "热门电影" is defined in zh/viewer.ts under home.rails
      // "热门电影" 在 zh/viewer.ts 的 home.rails 下有定义
      expect(translateRailName(getT(), "热门电影")).toBe("热门电影");
    });

    it("returns the label for 热门剧集", () => {
      expect(translateRailName(getT(), "热门剧集")).toBe("热门剧集");
    });

    it("returns the label for 热门动漫", () => {
      expect(translateRailName(getT(), "热门动漫")).toBe("热门动漫");
    });

    it("returns the label for 热门综艺", () => {
      expect(translateRailName(getT(), "热门综艺")).toBe("热门综艺");
    });

    it("falls back to the raw name for an unknown rail key", () => {
      // "未知分区" is not in the translation table; must return the raw name exactly.
      // "未知分区" 不在翻译表中; 必须原样返回.
      expect(translateRailName(getT(), "未知分区")).toBe("未知分区");
    });

    it("falls back gracefully for an empty string name", () => {
      // An empty name should not produce a visible i18n key or crash.
      // 空名称不应产生可见 i18n key 或崩溃.
      expect(translateRailName(getT(), "")).toBe("");
    });

    it("falls back gracefully for a name with special characters", () => {
      // Special characters must not trigger i18next interpolation or crash.
      // 特殊字符不能触发 i18next 插值或崩溃.
      const special = "{{section}} & more";
      expect(translateRailName(getT(), special)).toBe(special);
    });

    it("falls back to the raw name for a plausible future rail name not yet in the table", () => {
      expect(translateRailName(getT(), "热门纪录片")).toBe("热门纪录片");
    });
  });

  describe("when language is en", () => {
    beforeEach(async () => {
      await i18n.changeLanguage("en");
    });

    afterEach(async () => {
      await i18n.changeLanguage("zh");
    });

    it("returns the English label for 热门电影 when locale is en", () => {
      // The English locale maps "热门电影" → "Popular Movies".
      // 英文 locale 将 "热门电影" 映射为 "Popular Movies".
      expect(translateRailName(getT(), "热门电影")).toBe("Popular Movies");
    });

    it("returns the English label for 热门剧集 when locale is en", () => {
      expect(translateRailName(getT(), "热门剧集")).toBe("Popular TV");
    });

    it("returns the English label for 热门动漫 when locale is en", () => {
      expect(translateRailName(getT(), "热门动漫")).toBe("Popular Anime");
    });

    it("returns the English label for 热门综艺 when locale is en", () => {
      expect(translateRailName(getT(), "热门综艺")).toBe("Popular Variety");
    });

    it("falls back to the raw name for an unknown rail key in en locale", () => {
      expect(translateRailName(getT(), "未知分区")).toBe("未知分区");
    });
  });
});
