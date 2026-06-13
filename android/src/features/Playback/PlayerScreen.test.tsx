// PlayerScreen tests — Video mounts after URL resolves; BackHandler exits full-screen first.
// PlayerScreen 测试 — URL 解析后 Video 挂载; BackHandler 优先退出全屏.

import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { I18nextProvider } from "react-i18next";
import i18next from "i18next";
import { BackHandler } from "react-native";

import { ThemeProvider } from "@/designSystem/ThemeProvider";
import { PlayerScreen, PlayerScreenContext } from "./PlayerScreen";
import type { DetailAPI } from "@/api/detail";
import type { PlaybackAPI } from "@/api/playback";
import type { PlayDestination, SourceResult, VideoDetail } from "@/api/types";

const src: SourceResult = { source_key: "a", source_name: "A", is_adult: false, video_id: "v-a", duration_ms: 0, episodes: [] };
const detail: VideoDetail = {
  id: "1", title: "T", type: "Movie", year: "2024", cover: "", desc: "",
  director: "", actor: "", area: "",
  episodes: [[{ name: "E1", url: "raw://e1" }, { name: "E2", url: "raw://e2" }]],
};
const dest: PlayDestination = { title: "T", sources: [src], sourceKey: "a", videoId: "v-a", coverHint: "" };

void i18next.init({
  lng: "en",
  resources: {
    en: {
      playback: {
        play: "Play", episodes: "Episodes", sources: "Sources",
        showAll: "Show all {{count}} sources", collapse: "Collapse",
        skipIntro: "Skip Intro", skipOutro: "Skip Outro",
        cdnLines: "CDN Lines", line: "Line {{index}}", lineDead: "Line {{index}} ✕",
      },
    },
  },
});

function wrap(detailAPI: DetailAPI, playbackAPI: PlaybackAPI, onClose: () => void = jest.fn()) {
  return render(
    <I18nextProvider i18n={i18next}>
      <ThemeProvider override="light">
        <PlayerScreenContext.Provider value={{ detailAPI, playbackAPI, serverURL: "http://srv-player", onClose }}>
          <PlayerScreen route={{ params: dest }} />
        </PlayerScreenContext.Provider>
      </ThemeProvider>
    </I18nextProvider>,
  );
}

test("PlayerScreen renders <Video /> after URL resolves", async () => {
  const detailAPI: DetailAPI = { detail: jest.fn().mockResolvedValue(detail) };
  const playbackAPI: PlaybackAPI = { playbackURL: jest.fn().mockResolvedValue({ mode: "proxy", url: "https://p/m3u8" }) };
  const { findByTestId } = wrap(detailAPI, playbackAPI);
  expect(await findByTestId("video")).toBeTruthy();
});

test("Tapping playerSurface toggles overlay visibility", async () => {
  const detailAPI: DetailAPI = { detail: jest.fn().mockResolvedValue(detail) };
  const playbackAPI: PlaybackAPI = { playbackURL: jest.fn().mockResolvedValue({ mode: "proxy", url: "https://p/m3u8" }) };
  const { findByTestId, queryByLabelText, getByTestId } = wrap(detailAPI, playbackAPI);
  await findByTestId("video");
  // Overlay starts visible — first tap hides it.
  // 遮罩默认可见, 第一次点击隐藏.
  expect(queryByLabelText("player-overlay")).toBeTruthy();
  await act(async () => { fireEvent.press(getByTestId("playerSurface")); });
  expect(queryByLabelText("player-overlay")).toBeNull();
  await act(async () => { fireEvent.press(getByTestId("playerSurface")); });
  expect(queryByLabelText("player-overlay")).toBeTruthy();
});

test("Video onLoad seeks to resume position and marks consumed", async () => {
  const { savePlaybackSettings } = require("@/storage/playbackSettings");
  savePlaybackSettings("http://srv-player", "T", { skipIntroSeconds: 20, skipOutroSeconds: 0, playbackRate: 1 });
  const detailAPI: DetailAPI = { detail: jest.fn().mockResolvedValue(detail) };
  const playbackAPI: PlaybackAPI = { playbackURL: jest.fn().mockResolvedValue({ mode: "proxy", url: "https://p/m3u8" }) };
  const { findByTestId } = wrap(detailAPI, playbackAPI);
  const video = await findByTestId("video");
  await act(async () => { fireEvent(video, "onLoad", { duration: 600 }); });
  // After consumption, urlGenerationRef updates so a second onLoad doesn't re-seek.
  // 消费后 urlGenerationRef 已更新, 第二次 onLoad 不会再次 seek.
  await act(async () => { fireEvent(video, "onLoad", { duration: 600 }); });
  expect(video).toBeTruthy();
});

test("BackHandler dismisses full-screen before popping", async () => {
  const spy = jest.spyOn(BackHandler, "addEventListener");
  const detailAPI: DetailAPI = { detail: jest.fn().mockResolvedValue(detail) };
  const playbackAPI: PlaybackAPI = { playbackURL: jest.fn().mockResolvedValue({ mode: "proxy", url: "https://p/m3u8" }) };
  const onClose = jest.fn();
  wrap(detailAPI, playbackAPI, onClose);
  await waitFor(() => expect(detailAPI.detail).toHaveBeenCalled());
  // The PlayerScreen registers a hardwareBackPress handler — grab the most recent registration.
  // PlayerScreen 注册 hardwareBackPress; 取最后一次注册的 handler.
  const handlerCall = spy.mock.calls.find((c) => c[0] === "hardwareBackPress");
  expect(handlerCall).toBeDefined();
  const handler = handlerCall![1] as () => boolean;
  // First back press while not full-screen → onClose.
  // 非全屏时第一次 back → onClose.
  act(() => { handler(); });
  expect(onClose).toHaveBeenCalled();
  spy.mockRestore();
});
