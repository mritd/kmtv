// LanguageSection tests.
// LanguageSection 测试.

import { fireEvent, render, waitFor } from "@testing-library/react-native";
import i18next from "i18next";
import React from "react";

import { initI18n } from "@/i18n";
import { _resetForTests } from "@/storage/mmkv";
import { useI18nStore } from "@/store/i18nStore";

import { LanguageSection } from "./LanguageSection";

beforeAll(async () => { await initI18n("en"); });

describe("LanguageSection", () => {
  beforeEach(() => { _resetForTests(); useI18nStore.setState({ lang: "en" }); });

  it("renders both pills and switches i18next language on tap", async () => {
    const { getByTestId } = render(<LanguageSection />);
    fireEvent.press(getByTestId("lang-zh"));
    await waitFor(() => {
      expect(useI18nStore.getState().lang).toBe("zh");
      expect(i18next.language).toBe("zh");
    });
  });

  it("active pill reflects accessibility selected state", () => {
    useI18nStore.setState({ lang: "zh" });
    const { getByTestId } = render(<LanguageSection />);
    expect(getByTestId("lang-zh").props.accessibilityState).toEqual({ selected: true });
    expect(getByTestId("lang-en").props.accessibilityState).toEqual({ selected: false });
  });

  afterAll(async () => { await i18next.changeLanguage("en"); });
});
