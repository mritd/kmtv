// Skeleton renders a View that hosts a reanimated brightness loop.
// Skeleton 渲染一个承载 reanimated 亮度循环的 View.

import { render } from "@testing-library/react-native";
import React from "react";

import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("renders the skeleton view", () => {
    const { getByTestId } = render(<Skeleton testID="skel" width={120} height={20} />);
    expect(getByTestId("skel")).toBeTruthy();
  });
});
