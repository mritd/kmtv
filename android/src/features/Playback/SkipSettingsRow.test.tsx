// SkipSettingsRow tests — chip labels, ± buttons, value clamp at 0.
// SkipSettingsRow 测试 — 胶囊文案、加减按钮、下限 0 截断.

import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { I18nextProvider } from "react-i18next";
import i18next from "i18next";

import { ThemeProvider } from "@/designSystem/ThemeProvider";
import { SkipSettingsRow } from "./SkipSettingsRow";

void i18next.init({
  lng: "en",
  resources: { en: { playback: { skipIntro: "Skip Intro", skipOutro: "Skip Outro" } } },
});

function wrap(node: React.ReactElement) {
  return render(
    <I18nextProvider i18n={i18next}><ThemeProvider override="light">{node}</ThemeProvider></I18nextProvider>,
  );
}

test("renders both chips with seconds suffix", () => {
  const { getByText, getAllByText } = wrap(
    <SkipSettingsRow
      skipIntroSeconds={30} skipOutroSeconds={0}
      onChangeIntro={() => {}} onChangeOutro={() => {}}
    />,
  );
  expect(getByText("Skip Intro")).toBeTruthy();
  expect(getByText("30s")).toBeTruthy();
  // Both chips show "0s" / "30s" — assert at least one "0s" exists.
  // 两个胶囊各自显示 0s/30s — 断言至少一个 0s 存在.
  expect(getAllByText("0s").length).toBeGreaterThan(0);
});

test("+ button dispatches +5", () => {
  const onChangeIntro = jest.fn();
  const { getAllByLabelText } = wrap(
    <SkipSettingsRow
      skipIntroSeconds={10} skipOutroSeconds={0}
      onChangeIntro={onChangeIntro} onChangeOutro={() => {}}
    />,
  );
  fireEvent.press(getAllByLabelText("increment")[0]!);
  expect(onChangeIntro).toHaveBeenCalledWith(15);
});

test("- button dispatches -5 but stops at 0", () => {
  const onChangeIntro = jest.fn();
  const { getAllByLabelText } = wrap(
    <SkipSettingsRow
      skipIntroSeconds={3} skipOutroSeconds={0}
      onChangeIntro={onChangeIntro} onChangeOutro={() => {}}
    />,
  );
  fireEvent.press(getAllByLabelText("decrement")[0]!);
  expect(onChangeIntro).toHaveBeenCalledWith(0);
});
