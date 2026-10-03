// ContinueWatchingRow tests: empty list returns null, header + clear renders, progress ratio computed.
//
// ContinueWatchingRow 测试: 空列表返回 null, 渲染 header + clear, 计算进度条比例.

import { fireEvent, render } from "@testing-library/react-native";
import React from "react";

import { ThemeProvider } from "@/designSystem/ThemeProvider";
import { initI18n } from "@/i18n";
import type { LocalRecord, WatchPayload } from "@/sync/types";

import { ContinueWatchingRow } from "./ContinueWatchingRow";

function item(p: Partial<WatchPayload> & { key?: string } = {}): LocalRecord<"watch"> {
  const { key = "t", ...payload } = p;
  return {
    kind: "watch",
    key,
    eventTimeMs: 1,
    deleted: false,
    dirty: false,
    synced: true,
    payload: {
      title: "T",
      cover: "/c.jpg",
      source_key: "src",
      video_id: "v",
      episode: "EP1",
      group_index: 0,
      episode_index: 0,
      progress_sec: 250,
      duration_sec: 1000,
      completed: false,
      ...payload,
    },
  };
}

function wrap(node: React.ReactNode) {
  return <ThemeProvider override="system">{node}</ThemeProvider>;
}

beforeAll(async () => {
  await initI18n("en");
});

describe("ContinueWatchingRow", () => {
  it("returns null when watchHistory is empty", () => {
    const { toJSON } = render(wrap(
      <ContinueWatchingRow baseURL="https://x" watchHistory={[]} onClear={() => undefined} />,
    ));
    expect(toJSON()).toBeNull();
  });

  it("renders header and items", () => {
    const { getByText, getAllByTestId } = render(wrap(
      <ContinueWatchingRow
        baseURL="https://x"
        watchHistory={[item({ key: "a", title: "Alpha" }), item({ key: "b", title: "Beta" })]}
        onClear={() => undefined}
      />,
    ));
    expect(getByText("Continue Watching")).toBeTruthy();
    expect(getAllByTestId("continueCard").length).toBe(2);
  });

  it("clear button triggers onClear", () => {
    const onClear = jest.fn();
    const { getByText } = render(wrap(
      <ContinueWatchingRow baseURL="https://x" watchHistory={[item()]} onClear={onClear} />,
    ));
    fireEvent.press(getByText("Clear"));
    expect(onClear).toHaveBeenCalled();
  });

  it("progress fill width equals progress/duration as a percent string", () => {
    const { getAllByTestId } = render(wrap(
      <ContinueWatchingRow
        baseURL="https://x"
        watchHistory={[item({ progress_sec: 250, duration_sec: 1000 })]}
        onClear={() => undefined}
      />,
    ));
    const fill = getAllByTestId("continueProgressFill")[0]!;
    expect(fill.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: "25%" })]),
    );
  });

  it("clamps the progress fill width to 100% when progress exceeds duration", () => {
    const { getAllByTestId } = render(wrap(
      <ContinueWatchingRow
        baseURL="https://x"
        watchHistory={[item({ progress_sec: 2000, duration_sec: 1000 })]}
        onClear={() => undefined}
      />,
    ));
    const fill = getAllByTestId("continueProgressFill")[0]!;
    expect(fill.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: "100%" })]),
    );
  });

  it("omits the progress bar entirely when duration is 0", () => {
    const { queryByTestId } = render(wrap(
      <ContinueWatchingRow
        baseURL="https://x"
        watchHistory={[item({ progress_sec: 0, duration_sec: 0 })]}
        onClear={() => undefined}
      />,
    ));
    expect(queryByTestId("continueProgressTrack")).toBeNull();
  });
});
