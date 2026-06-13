// IconButton tests.
// IconButton 测试.

import { render, fireEvent } from "@testing-library/react-native";
import React from "react";

import { IconButton } from "./IconButton";

describe("IconButton", () => {
  it("renders the icon and dispatches onPress on tap", () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <IconButton testID="btn" name="star" onPress={onPress} accessibilityLabel="favorite" />,
    );
    fireEvent.press(getByTestId("btn"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
  it("reflects active state via accessibilityState.selected", () => {
    const { getByTestId, rerender } = render(
      <IconButton testID="btn" name="star" onPress={() => {}} accessibilityLabel="x" active />,
    );
    expect(getByTestId("btn").props.accessibilityState).toEqual({ selected: true });
    rerender(
      <IconButton testID="btn" name="star-outline" onPress={() => {}} accessibilityLabel="x" />,
    );
    expect(getByTestId("btn").props.accessibilityState).toEqual({ selected: false });
  });
  it("does not fire onPress when disabled", () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <IconButton testID="btn" name="star" onPress={onPress} accessibilityLabel="x" disabled />,
    );
    fireEvent.press(getByTestId("btn"));
    expect(onPress).not.toHaveBeenCalled();
  });
});
