// HeroCarousel test: renders all items, advances index after 5 s via fake timers.
// HeroCarousel 测试: 渲染全部条目, 通过假定时器在 5 秒后推进索引.

import { act, render } from "@testing-library/react-native";
import React from "react";

import type { DoubanItem } from "@/api/types";
import { ThemeProvider } from "@/designSystem/ThemeProvider";

import { HeroCarousel } from "./HeroCarousel";

const items: DoubanItem[] = [
  { id: "1", title: "Slide A", cover: "/a.jpg", rate: "8.5", year: "2024" },
  { id: "2", title: "Slide B", cover: "/b.jpg", rate: "9.0", year: "2023" },
];

function wrap(node: React.ReactNode) {
  return <ThemeProvider override="system">{node}</ThemeProvider>;
}

describe("HeroCarousel", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.useRealTimers(); });

  it("renders all hero items", () => {
    const { queryByText } = render(wrap(<HeroCarousel baseURL="https://x" items={items} />));
    expect(queryByText("Slide A")).not.toBeNull();
    expect(queryByText("Slide B")).not.toBeNull();
  });

  it("calls scrollToIndex(1) after the first 5 s tick, then back to 0 after the second tick", () => {
    const { FlatList } = require("react-native") as { FlatList: { prototype: { scrollToIndex: (..._args: unknown[]) => void } } };
    const spy = jest.spyOn(FlatList.prototype, "scrollToIndex").mockImplementation(() => undefined);
    render(wrap(<HeroCarousel baseURL="https://x" items={items} />));
    act(() => { jest.advanceTimersByTime(5000); });
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ index: 1 }));
    act(() => { jest.advanceTimersByTime(5000); });
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ index: 0 }));
    spy.mockRestore();
  });

  it("does not auto-advance when there is only one item", () => {
    const { FlatList } = require("react-native") as { FlatList: { prototype: { scrollToIndex: (..._args: unknown[]) => void } } };
    const spy = jest.spyOn(FlatList.prototype, "scrollToIndex").mockImplementation(() => undefined);
    render(wrap(<HeroCarousel baseURL="https://x" items={[items[0]!]} />));
    act(() => { jest.advanceTimersByTime(15000); });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("renders nothing when items is empty", () => {
    const { toJSON } = render(wrap(<HeroCarousel baseURL="https://x" items={[]} />));
    // The ThemeProvider wraps an empty fragment but HeroCarousel itself returns null.
    // ThemeProvider 包裹了空 fragment, HeroCarousel 自身返回 null.
    expect(toJSON()).toBeNull();
  });
});
