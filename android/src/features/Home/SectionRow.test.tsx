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
});
