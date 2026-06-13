// English. 中文.
// i18n setup smoke test — verifies translation lookup works for both languages.
// i18n 设置冒烟测试, 验证两种语言的翻译查找.

import { initI18n } from "./index";

describe("initI18n", () => {
  it("returns 'Home' under en", async () => {
    const i18n = await initI18n("en");
    expect(i18n.t("links.home", { ns: "nav" })).toBe("Home");
  });

  it("returns '首页' under zh", async () => {
    const i18n = await initI18n("zh");
    expect(i18n.t("links.home", { ns: "nav" })).toBe("首页");
  });
});
