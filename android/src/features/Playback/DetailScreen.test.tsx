// DetailScreen tests — loading skeleton + post-load render + Play CTA propagation + responsive layout.
// DetailScreen 测试 — 加载骨架、加载后渲染、Play 按钮回调、响应式布局.

import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { I18nextProvider } from "react-i18next";
import i18next from "i18next";
import { StyleSheet, useWindowDimensions } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ThemeProvider } from "@/designSystem/ThemeProvider";
import { DetailScreen, DetailScreenContext, type DetailScreenContextValue } from "./DetailScreen";
import type { DetailAPI } from "@/api/detail";
import type { PlayDestination, SourceResult, VideoDetail } from "@/api/types";

jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  default: jest.fn(() => ({ width: 400, height: 800, scale: 2, fontScale: 1 })),
}));
const mockedDims = useWindowDimensions as unknown as jest.Mock;

const src: SourceResult = { source_key: "a", source_name: "A", is_adult: false, video_id: "v-a", duration_ms: 0, episodes: [] };
const detail: VideoDetail = {
  id: "1", title: "Inception", type: "Movie", year: "2010", cover: "/cover.jpg", desc: "A heist.",
  director: "Nolan", actor: "Leo", area: "USA",
  episodes: [[{ name: "Full", url: "raw://e1" }]],
};
const dest: PlayDestination = { title: "Inception", sources: [src], sourceKey: "a", videoId: "v-a", coverHint: "" };

const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

void i18next.init({
  lng: "en",
  resources: {
    en: {
      playback: {
        play: "Play", sources: "Sources", episodes: "Episodes",
        skipIntro: "Skip Intro", skipOutro: "Skip Outro",
        showAll: "Show all {{count}} sources", collapse: "Collapse",
      },
    },
  },
});

function wrap(ctx: DetailScreenContextValue, route: { params: PlayDestination }) {
  return render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <I18nextProvider i18n={i18next}>
        <ThemeProvider override="light">
          <DetailScreenContext.Provider value={ctx}>
            <DetailScreen route={route} />
          </DetailScreenContext.Provider>
        </ThemeProvider>
      </I18nextProvider>
    </SafeAreaProvider>,
  );
}

test("DetailScreen shows skeleton until detail loads, then shows title", async () => {
  let resolve!: (v: VideoDetail) => void;
  const api: DetailAPI = { detail: jest.fn(() => new Promise<VideoDetail>((r) => { resolve = r; })) };
  const { getByTestId, getByText, queryByTestId } = wrap(
    { detailAPI: api, serverURL: "http://s", onPlay: jest.fn() },
    { params: dest },
  );
  expect(getByTestId("detailLoading")).toBeTruthy();
  resolve(detail);
  await waitFor(() => expect(queryByTestId("detailLoading")).toBeNull());
  expect(getByText("Inception")).toBeTruthy();
});

test("Multi-source SourceSwitcher click reloads detail from chosen source", async () => {
  const srcA: SourceResult = { source_key: "a", source_name: "A", is_adult: false, video_id: "v-a", duration_ms: 0, episodes: [] };
  const srcB: SourceResult = { source_key: "b", source_name: "B", is_adult: false, video_id: "v-b", duration_ms: 0, episodes: [] };
  const extraSources = ["c", "d", "e", "f", "g", "h"].map((key) => ({
    source_key: key,
    source_name: key.toUpperCase(),
    is_adult: false,
    video_id: `v-${key}`,
    duration_ms: 0,
    episodes: [],
  }));
  const multiDest: PlayDestination = {
    title: "Inception",
    sources: [srcA, srcB, ...extraSources],
    sourceKey: "a",
    videoId: "v-a",
    coverHint: "",
  };
  const detailB: VideoDetail = { ...detail, title: "Inception-B" };
  const api: DetailAPI = {
    detail: jest.fn()
      .mockResolvedValueOnce(detail)
      .mockResolvedValueOnce(detailB),
  };
  const { findByText, getByText, queryByText } = wrap(
    { detailAPI: api, serverURL: "http://s", onPlay: jest.fn() },
    { params: multiDest },
  );
  await findByText("Inception");
  expect(queryByText("H")).toBeNull();
  expect(getByText("Show all 8 sources")).toBeTruthy();
  fireEvent.press(getByText("Show all 8 sources"));
  expect(getByText("H")).toBeTruthy();
  fireEvent.press(getByText("B"));
  await waitFor(() => expect(api.detail).toHaveBeenCalledWith("b", "v-b"));
});

test("Play CTA invokes context onPlay with destination", async () => {
  const api: DetailAPI = { detail: jest.fn().mockResolvedValue(detail) };
  const onPlay = jest.fn();
  const { getByText, findByText } = wrap(
    { detailAPI: api, serverURL: "http://s", onPlay },
    { params: dest },
  );
  await findByText("Inception");
  fireEvent.press(getByText("Play"));
  expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ title: "Inception", sourceKey: "a" }));
});

test("favorite toggle persists with active source's video_id", async () => {
  const { _resetForTests } = require("@/storage/mmkv");
  const { isFavorited } = require("@/storage/favorites");
  _resetForTests();
  const api: DetailAPI = { detail: jest.fn().mockResolvedValue(detail) };
  const { findByText, getByTestId } = wrap(
    { detailAPI: api, serverURL: "http://s", onPlay: jest.fn() },
    { params: dest },
  );
  await findByText("Inception");
  fireEvent.press(getByTestId("detailFavorite"));
  expect(isFavorited("http://s", "a", "v-a")).toBe(true);
  fireEvent.press(getByTestId("detailFavorite"));
  expect(isFavorited("http://s", "a", "v-a")).toBe(false);
});

describe("DetailScreen responsive layout", () => {
  afterEach(() => mockedDims.mockReturnValue({ width: 400, height: 800, scale: 2, fontScale: 1 }));

  test("phone (width 400) stacks poster on top with compact size", async () => {
    mockedDims.mockReturnValue({ width: 400, height: 800, scale: 2, fontScale: 1 });
    const api: DetailAPI = { detail: jest.fn().mockResolvedValue(detail) };
    const { findByTestId } = wrap(
      { detailAPI: api, serverURL: "http://s", onPlay: jest.fn() },
      { params: dest },
    );
    const poster = await findByTestId("detailPoster");
    const flat = StyleSheet.flatten(poster.props.style);
    expect(flat).toEqual(expect.objectContaining({ width: 110, height: 165 }));
    expect(await findByTestId("detailHero")).toBeTruthy();
  });

  test("tablet (width 800) places poster + info side by side with taller poster", async () => {
    mockedDims.mockReturnValue({ width: 800, height: 1280, scale: 2, fontScale: 1 });
    const api: DetailAPI = { detail: jest.fn().mockResolvedValue(detail) };
    const { findByTestId } = wrap(
      { detailAPI: api, serverURL: "http://s", onPlay: jest.fn() },
      { params: dest },
    );
    const poster = await findByTestId("detailPoster");
    const flat = StyleSheet.flatten(poster.props.style);
    expect(flat).toEqual(expect.objectContaining({ width: 200, height: 300 }));
  });
});

test("switching source then tapping favorite uses the new source's video_id", async () => {
  const { _resetForTests } = require("@/storage/mmkv");
  const { isFavorited } = require("@/storage/favorites");
  _resetForTests();
  const srcB: SourceResult = { source_key: "b", source_name: "B", is_adult: false, video_id: "v-b-new",
    duration_ms: 0, episodes: [] };
  const multiDest = { ...dest, sources: [src, srcB] };
  const detailB: VideoDetail = { ...detail, id: "2" };
  const api: DetailAPI = {
    detail: jest.fn()
      .mockResolvedValueOnce(detail)
      .mockResolvedValueOnce(detailB),
  };
  const { findByText, getByText, getByTestId } = wrap(
    { detailAPI: api, serverURL: "http://s", onPlay: jest.fn() },
    { params: multiDest },
  );
  await findByText("Inception");
  fireEvent.press(getByText("B"));
  await waitFor(() => expect(api.detail).toHaveBeenCalledWith("b", "v-b-new"));
  fireEvent.press(getByTestId("detailFavorite"));
  expect(isFavorited("http://s", "b", "v-b-new")).toBe(true);
  // Original source's tuple stays untoggled.
  expect(isFavorited("http://s", "a", "v-a")).toBe(false);
});
