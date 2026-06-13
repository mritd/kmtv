// Toast tests confirm show -> visible -> auto-dismiss; consecutive show cancels prior timer.
// Toast 测试确认 show -> 可见 -> 自动消失; 连续 show 会取消之前的计时器.

import { act, fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";

import { ThemeProvider } from "./ThemeProvider";
import { ToastHost, ToastProvider, useToast } from "./Toast";

function Trigger({ message }: { message: string }) {
  const { show } = useToast();
  return <Text onPress={() => show(message)}>fire</Text>;
}

function wrap(children: React.ReactNode) {
  return (
    <ThemeProvider override="system">
      <ToastProvider>
        {children}
        <ToastHost />
      </ToastProvider>
    </ThemeProvider>
  );
}

describe("Toast", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.useRealTimers(); });

  it("show makes the message visible", () => {
    const { getByText, queryByText } = render(wrap(<Trigger message="hello" />));
    expect(queryByText("hello")).toBeNull();
    fireEvent.press(getByText("fire"));
    expect(queryByText("hello")).not.toBeNull();
  });

  it("auto-dismisses after 3000 ms", () => {
    const { getByText, queryByText } = render(wrap(<Trigger message="bye" />));
    fireEvent.press(getByText("fire"));
    expect(queryByText("bye")).not.toBeNull();
    act(() => { jest.advanceTimersByTime(3000); });
    expect(queryByText("bye")).toBeNull();
  });
});
