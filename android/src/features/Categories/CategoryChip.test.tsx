// CategoryChip render + press + active state tests.
// CategoryChip 渲染、点击与选中态测试.

import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";

import { ThemeProvider } from "@/designSystem/ThemeProvider";

import { CategoryChip } from "./CategoryChip";

function withTheme(node: React.ReactElement) {
  return render(<ThemeProvider override="light">{node}</ThemeProvider>);
}

describe("CategoryChip", () => {
  it("renders label and fires onPress", () => {
    const onPress = jest.fn();
    withTheme(<CategoryChip label="热门" active={false} onPress={onPress} />);
    fireEvent.press(screen.getByText("热门"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("marks the active chip with accessibilityState selected", () => {
    withTheme(<CategoryChip label="电影" active testID="movie-chip" onPress={jest.fn()} />);
    const node = screen.getByTestId("movie-chip");
    expect(node.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
  });
});
