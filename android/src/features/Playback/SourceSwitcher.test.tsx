// SourceSwitcher tests — full render, collapse toggle, click propagation.
// SourceSwitcher 测试 — 完整渲染、折叠切换、点击透传.

import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { I18nextProvider } from "react-i18next";
import i18next from "i18next";

import { ThemeProvider } from "@/designSystem/ThemeProvider";
import { SourceSwitcher } from "./SourceSwitcher";
import type { SourceResult } from "@/api/types";

void i18next.init({
  lng: "en",
  resources: { en: { playback: { showAll: "Show all {{count}} sources", collapse: "Collapse" } } },
});

const src = (k: string): SourceResult => ({
  source_key: k, source_name: `name-${k}`, is_adult: false, video_id: `v-${k}`,
  duration_ms: 0, episodes: [],
});

function wrap(node: React.ReactElement) {
  return render(
    <I18nextProvider i18n={i18next}><ThemeProvider override="light">{node}</ThemeProvider></I18nextProvider>,
  );
}

test("renders all sources when count <= 6", () => {
  const sources = ["a", "b", "c"].map(src);
  const { getByText, queryByText } = wrap(
    <SourceSwitcher sources={sources} currentKey="a" onSelect={() => {}} />,
  );
  expect(getByText("name-a")).toBeTruthy();
  expect(getByText("name-c")).toBeTruthy();
  expect(queryByText("Collapse")).toBeNull();
});

test("collapses long lists to first 6 with Show all toggle", () => {
  const sources = ["a", "b", "c", "d", "e", "f", "g", "h"].map(src);
  const { getByText, queryByText } = wrap(
    <SourceSwitcher sources={sources} currentKey="a" onSelect={() => {}} />,
  );
  expect(queryByText("name-h")).toBeNull();
  expect(getByText("Show all 8 sources")).toBeTruthy();
  fireEvent.press(getByText("Show all 8 sources"));
  expect(getByText("name-h")).toBeTruthy();
  expect(getByText("Collapse")).toBeTruthy();
});

test("onSelect propagates clicked source key", () => {
  const onSelect = jest.fn();
  const sources = ["a", "b"].map(src);
  const { getByText } = wrap(<SourceSwitcher sources={sources} currentKey="a" onSelect={onSelect} />);
  fireEvent.press(getByText("name-b"));
  expect(onSelect).toHaveBeenCalledWith("b");
});
