// DetailScreen tests — loading skeleton + post-load render + Play CTA propagation.
// DetailScreen 测试 — 加载骨架、加载后渲染、Play 按钮回调.

import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { I18nextProvider } from "react-i18next";
import i18next from "i18next";

import { ThemeProvider } from "@/designSystem/ThemeProvider";
import { DetailScreen, DetailScreenContext, type DetailScreenContextValue } from "./DetailScreen";
import type { DetailAPI } from "@/api/detail";
import type { PlayDestination, SourceResult, VideoDetail } from "@/api/types";

const src: SourceResult = { source_key: "a", source_name: "A", is_adult: false, video_id: "v-a", duration_ms: 0, episodes: [] };
const detail: VideoDetail = {
  id: "1", title: "Inception", type: "Movie", year: "2010", cover: "/cover.jpg", desc: "A heist.",
  director: "Nolan", actor: "Leo", area: "USA",
  episodes: [[{ name: "Full", url: "raw://e1" }]],
};
const dest: PlayDestination = { title: "Inception", sources: [src], sourceKey: "a", videoId: "v-a", coverHint: "" };

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
    <I18nextProvider i18n={i18next}>
      <ThemeProvider override="light">
        <DetailScreenContext.Provider value={ctx}>
          <DetailScreen route={route} />
        </DetailScreenContext.Provider>
      </ThemeProvider>
    </I18nextProvider>,
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
  const multiDest: PlayDestination = { title: "Inception", sources: [srcA, srcB], sourceKey: "a", videoId: "v-a", coverHint: "" };
  const detailB: VideoDetail = { ...detail, title: "Inception-B" };
  const api: DetailAPI = {
    detail: jest.fn()
      .mockResolvedValueOnce(detail)
      .mockResolvedValueOnce(detailB),
  };
  const { findByText, getByText } = wrap(
    { detailAPI: api, serverURL: "http://s", onPlay: jest.fn() },
    { params: multiDest },
  );
  await findByText("Inception");
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
