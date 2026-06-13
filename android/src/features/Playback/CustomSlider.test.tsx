// CustomSlider tests — drive the drag callbacks via the test escape hatch.
// CustomSlider 测试 — 通过测试逃生口驱动拖动回调.

import { render } from "@testing-library/react-native";
import React from "react";

import { CustomSlider } from "./CustomSlider";

test("CustomSlider fires drag callbacks via test pan", () => {
  const onDragStart = jest.fn();
  const onDragEnd = jest.fn();
  let panRef: ((ratio: number, phase: "start" | "end") => void) | undefined;
  render(
    <CustomSlider
      value={0.25}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      _panForTest={(fn) => { panRef = fn; }}
    />,
  );
  expect(panRef).toBeDefined();
  panRef!(0.5, "start");
  expect(onDragStart).toHaveBeenCalled();
  panRef!(0.75, "end");
  expect(onDragEnd).toHaveBeenCalledWith(0.75);
});

test("CustomSlider clamps drag ratio to [0, 1]", () => {
  const onDragEnd = jest.fn();
  let panRef: ((ratio: number, phase: "start" | "end") => void) | undefined;
  render(
    <CustomSlider value={0} onDragEnd={onDragEnd} _panForTest={(fn) => { panRef = fn; }} />,
  );
  panRef!(-0.5, "end");
  expect(onDragEnd).toHaveBeenCalledWith(0);
  panRef!(2, "end");
  expect(onDragEnd).toHaveBeenLastCalledWith(1);
});

test("CustomSlider renders with testID", () => {
  const { getByTestId } = render(<CustomSlider value={0.5} testID="slider" />);
  expect(getByTestId("slider")).toBeTruthy();
});
