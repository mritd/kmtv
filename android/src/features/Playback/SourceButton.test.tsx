// SourceButton tests — text, press, accessibilityState propagation.
// SourceButton 测试 — 文案、点击与 accessibilityState 传播.

import { fireEvent, render } from "@testing-library/react-native";
import React from "react";

import { ThemeProvider } from "@/designSystem/ThemeProvider";
import { SourceButton } from "./SourceButton";
import type { SourceResult } from "@/api/types";

const src: SourceResult = {
  source_key: "k1", source_name: "Cool Source", is_adult: false,
  video_id: "v1", duration_ms: 0, episodes: [],
};

function wrap(node: React.ReactElement) {
  return render(<ThemeProvider override="light">{node}</ThemeProvider>);
}

test("renders sourceName, fires onPress with key", () => {
  const onPress = jest.fn();
  const { getByText } = wrap(<SourceButton source={src} isSelected={false} onPress={onPress} />);
  fireEvent.press(getByText("Cool Source"));
  expect(onPress).toHaveBeenCalledWith("k1");
});

test("selected style differs from unselected (accessibilityState reflects it)", () => {
  const { getByRole, rerender } = wrap(<SourceButton source={src} isSelected={false} onPress={() => {}} />);
  expect(getByRole("button").props.accessibilityState).toEqual({ selected: false });
  rerender(<ThemeProvider override="light"><SourceButton source={src} isSelected={true} onPress={() => {}} /></ThemeProvider>);
  expect(getByRole("button").props.accessibilityState).toEqual({ selected: true });
});
