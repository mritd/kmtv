// ThemeSection tests.
// ThemeSection 测试.

import { fireEvent, render } from "@testing-library/react-native";
import React from "react";

import { initI18n } from "@/i18n";
import { _resetForTests } from "@/storage/mmkv";
import { useThemeStore } from "@/store/themeStore";

import { ThemeSection } from "./ThemeSection";

beforeAll(async () => { await initI18n("en"); });

describe("ThemeSection", () => {
  beforeEach(() => { _resetForTests(); useThemeStore.setState({ override: "system" }); });

  it("renders three pills and stores selection on tap", () => {
    const { getByTestId } = render(<ThemeSection />);
    fireEvent.press(getByTestId("theme-dark"));
    expect(useThemeStore.getState().override).toBe("dark");
    fireEvent.press(getByTestId("theme-light"));
    expect(useThemeStore.getState().override).toBe("light");
    fireEvent.press(getByTestId("theme-system"));
    expect(useThemeStore.getState().override).toBe("system");
  });

  it("active pill reflects accessibility selected state", () => {
    useThemeStore.setState({ override: "dark" });
    const { getByTestId } = render(<ThemeSection />);
    expect(getByTestId("theme-dark").props.accessibilityState).toEqual({ selected: true });
    expect(getByTestId("theme-light").props.accessibilityState).toEqual({ selected: false });
    expect(getByTestId("theme-system").props.accessibilityState).toEqual({ selected: false });
  });
});
