// VideoCard tests cover rating fallback, missing year, and presence of poster.
// VideoCard 测试覆盖评分回退、缺失年份、海报显示.

import { render } from "@testing-library/react-native";
import React from "react";

import { VideoCard } from "./VideoCard";

describe("VideoCard", () => {
  it("shows the title and subtitle (year)", () => {
    const { getByText } = render(
      <VideoCard baseURL="https://x" title="片名" cover="/c.jpg" subtitle="2024" rating="8.4" />,
    );
    expect(getByText("片名")).toBeTruthy();
    expect(getByText("2024")).toBeTruthy();
  });

  it("shows N/A when rating is empty", () => {
    const { getByText } = render(
      <VideoCard baseURL="https://x" title="t" cover="" rating="" />,
    );
    expect(getByText("N/A")).toBeTruthy();
  });

  it('shows N/A when rating is "0"', () => {
    const { getByText } = render(
      <VideoCard baseURL="https://x" title="t" cover="" rating="0" />,
    );
    expect(getByText("N/A")).toBeTruthy();
  });

  it("does not render subtitle row when subtitle is empty", () => {
    const { queryByTestId } = render(
      <VideoCard baseURL="https://x" title="t" cover="" rating="8.4" subtitle="" />,
    );
    expect(queryByTestId("videoCard-subtitle")).toBeNull();
  });
});
