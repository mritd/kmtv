// SourceButton tests — text, press, accessibilityState propagation.
// SourceButton 测试 — 文案、点击与 accessibilityState 传播.

import { fireEvent, render } from "@testing-library/react-native";
import React from "react";

import { ThemeProvider } from "@/designSystem/ThemeProvider";
import { latencyColorForDuration, SourceButton } from "./SourceButton";
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
  const { getByTestId, getByText } = wrap(<SourceButton source={src} isSelected={false} onPress={onPress} />);
  expect(getByTestId("sourceButton-k1")).toBeTruthy();
  fireEvent.press(getByText("Cool Source"));
  expect(onPress).toHaveBeenCalledWith("k1");
});

test("cleans source decoration prefixes like iOS", () => {
  const decorated = { ...src, source_name: "🎬Cool Source" };
  const { getByText, queryByText } = wrap(<SourceButton source={decorated} isSelected={false} onPress={() => {}} />);
  expect(getByText("Cool Source")).toBeTruthy();
  expect(queryByText("🎬Cool Source")).toBeNull();
});

test("selected style differs from unselected (accessibilityState reflects it)", () => {
  const { getByRole, rerender } = wrap(<SourceButton source={src} isSelected={false} onPress={() => {}} />);
  expect(getByRole("button").props.accessibilityState).toEqual({ selected: false });
  rerender(<ThemeProvider override="light"><SourceButton source={src} isSelected={true} onPress={() => {}} /></ThemeProvider>);
  expect(getByRole("button").props.accessibilityState).toEqual({ selected: true });
});

test("renders source latency from duration_ms", () => {
  const fast = { ...src, duration_ms: 238 };
  const slow = { ...src, source_key: "k2", source_name: "Slow Source", duration_ms: 1240 };
  const { getByText, rerender } = wrap(<SourceButton source={fast} isSelected={false} onPress={() => {}} />);
  expect(getByText("238 ms")).toBeTruthy();

  rerender(<ThemeProvider override="light"><SourceButton source={slow} isSelected={false} onPress={() => {}} /></ThemeProvider>);
  expect(getByText("1.2 s")).toBeTruthy();
});

test("colors latency by response time tier", () => {
  expect(latencyColorForDuration(238)).toBe("#54d86a");
  expect(latencyColorForDuration(1240)).toBe("#f6c453");
  expect(latencyColorForDuration(3600)).toBe("#fb4667");
  expect(latencyColorForDuration(0)).toBeNull();
});
