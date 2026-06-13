// SectionRow tests: header text, items rendered, empty items still renders header.
// SectionRow 测试: header 文本、items 渲染、空 items 仍渲染 header.

import { render } from "@testing-library/react-native";
import React from "react";

import type { HomeSection } from "@/api/types";
import { ThemeProvider } from "@/designSystem/ThemeProvider";

import { SectionRow } from "./SectionRow";

const section: HomeSection = {
  name: "热门",
  tag: "hot",
  type: "movie",
  items: [
    { id: "1", title: "A", cover: "/a.jpg", rate: "7.5", year: "2024" },
    { id: "2", title: "B", cover: "/b.jpg", rate: "8.5", year: "2024" },
  ],
};

function wrap(node: React.ReactNode) {
  return <ThemeProvider override="system">{node}</ThemeProvider>;
}

describe("SectionRow", () => {
  it("renders the section name and all items", () => {
    const { getByText } = render(wrap(<SectionRow baseURL="https://x" section={section} />));
    expect(getByText("热门")).toBeTruthy();
    expect(getByText("A")).toBeTruthy();
    expect(getByText("B")).toBeTruthy();
  });

  it("renders header even if items is empty", () => {
    const empty: HomeSection = { ...section, items: [] };
    const { getByText } = render(wrap(<SectionRow baseURL="https://x" section={empty} />));
    expect(getByText("热门")).toBeTruthy();
  });

  it("virtualises with FlatList (large lists mount at least the initial window)", () => {
    const big: HomeSection = {
      ...section,
      items: Array.from({ length: 30 }, (_, i) => ({
        id: String(i),
        title: `T${i}`,
        cover: `/c${i}.jpg`,
        rate: "7.0",
        year: "2024",
      })),
    };
    const { getAllByTestId } = render(wrap(<SectionRow baseURL="https://x" section={big} />));
    // initialNumToRender = 6 lower bound; the test renderer may mount more.
    // initialNumToRender = 6 是下界, 测试 renderer 可能挂载更多.
    expect(getAllByTestId("sectionCard").length).toBeGreaterThanOrEqual(6);
  });
});
