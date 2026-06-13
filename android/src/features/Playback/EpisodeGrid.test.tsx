// EpisodeGrid tests — render all, press dispatches index, accessibilityState selected flag.
// EpisodeGrid 测试 — 渲染全部、点击派发索引、accessibilityState selected 标志.

import { fireEvent, render } from "@testing-library/react-native";
import React from "react";

import { ThemeProvider } from "@/designSystem/ThemeProvider";
import { EpisodeGrid } from "./EpisodeGrid";
import type { Episode } from "@/api/types";

const eps: Episode[] = Array.from({ length: 4 }, (_, i) => ({ name: `E${i + 1}`, url: `u${i + 1}` }));

function wrap(node: React.ReactElement) {
  return render(<ThemeProvider override="light">{node}</ThemeProvider>);
}

test("renders every episode and dispatches index on press", () => {
  const onSelect = jest.fn();
  const { getByText } = wrap(<EpisodeGrid episodes={eps} currentIndex={1} onSelect={onSelect} />);
  expect(getByText("E1")).toBeTruthy();
  expect(getByText("E4")).toBeTruthy();
  fireEvent.press(getByText("E3"));
  expect(onSelect).toHaveBeenCalledWith(2);
});

test("currentIndex marks selected episode via accessibilityState", () => {
  const { getAllByRole } = wrap(<EpisodeGrid episodes={eps} currentIndex={0} onSelect={() => {}} />);
  const buttons = getAllByRole("button");
  expect(buttons[0]!.props.accessibilityState).toEqual({ selected: true });
  expect(buttons[1]!.props.accessibilityState).toEqual({ selected: false });
});
