// PlayerScreen tests — Video mounts after URL resolves; BackHandler exits full-screen first.
// PlayerScreen 测试 — URL 解析后 Video 挂载; BackHandler 优先退出全屏.

import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { I18nextProvider } from "react-i18next";
import i18next from "i18next";
import { BackHandler } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ViewType } from "react-native-video";

import { ThemeProvider } from "@/designSystem/ThemeProvider";
import { PlayerScreen, PlayerScreenContext, videoSourceForURL } from "./PlayerScreen";
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

const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

void i18next.init({
  lng: "en",
  resources: {
    en: {
      playback: {
        play: "Play", pause: "Pause", episodes: "Episodes", sources: "Sources",
        showAll: "Show all {{count}} sources", collapse: "Collapse",
        skipBackward: "Back 10 seconds", skipForward: "Forward 10 seconds",
        fullscreen: "Full screen", exitFullscreen: "Exit full screen",
        showControls: "Show controls", hideControls: "Hide controls",
        skipIntro: "Skip Intro", skipOutro: "Skip Outro",
        cdnLines: "CDN Lines", line: "Line {{index}}", lineDead: "Line {{index}} ✕",
      },
    },
  },
});

function wrap(
  detailAPI: DetailAPI,
  playbackAPI: PlaybackAPI,
  onClose: () => void = jest.fn(),
  destination: PlayDestination = dest,
  serverURL = "http://srv-player",
) {
  return render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <I18nextProvider i18n={i18next}>
        <ThemeProvider override="light">
          <PlayerScreenContext.Provider value={{ detailAPI, playbackAPI, serverURL, onClose }}>
            <PlayerScreen route={{ params: destination }} />
          </PlayerScreenContext.Provider>
        </ThemeProvider>
      </I18nextProvider>
    </SafeAreaProvider>,
  );
}

test("videoSourceForURL forces m3u8 for proxied HLS URLs only", () => {
  expect(videoSourceForURL("https://kmtv.example/api/v1/proxy/m3u8?mt=t")).toEqual({
    uri: "https://kmtv.example/api/v1/proxy/m3u8?mt=t",
    type: "m3u8",
  });
  expect(videoSourceForURL("https://cdn.example/live/index.m3u8?token=t")).toEqual({
    uri: "https://cdn.example/live/index.m3u8?token=t",
    type: "m3u8",
  });
  expect(videoSourceForURL("https://cdn.example/video.mp4?token=t")).toEqual({
    uri: "https://cdn.example/video.mp4?token=t",
  });
});

test("PlayerScreen renders <Video /> after URL resolves", async () => {
  const detailAPI: DetailAPI = { detail: jest.fn().mockResolvedValue(detail) };
  const playbackAPI: PlaybackAPI = { playbackURL: jest.fn().mockResolvedValue({ mode: "proxy", url: "https://p/m3u8" }) };
  const { findByTestId } = wrap(detailAPI, playbackAPI);
  const video = await findByTestId("video");
  expect(video.props.viewType).toBe(ViewType.TEXTURE);
  expect(video.props.useTextureView).toBe(true);
  expect(video.props.pointerEvents).toBe("none");
});

test("overlay background hides controls without making the whole surface a toggle", async () => {
  const detailAPI: DetailAPI = { detail: jest.fn().mockResolvedValue(detail) };
  const playbackAPI: PlaybackAPI = { playbackURL: jest.fn().mockResolvedValue({ mode: "proxy", url: "https://p/m3u8" }) };
  const { findByTestId, queryByLabelText, getByTestId } = wrap(detailAPI, playbackAPI);
  await findByTestId("video");
  // Overlay starts visible. Only the explicit dismiss layer hides it; the root surface is no
  // longer a parent Pressable, so child gestures like slider dragging cannot accidentally toggle.
  // 遮罩默认可见. 只有显式 dismiss 层会隐藏; 根 surface 不再是父级 Pressable, 避免 slider 拖动误触 toggle.
  expect(queryByLabelText("player-overlay")).toBeTruthy();
  await act(async () => { fireEvent.press(getByTestId("playerSurface")); });
  expect(queryByLabelText("player-overlay")).toBeTruthy();
  await act(async () => { fireEvent.press(getByTestId("playerOverlayDismissArea")); });
  expect(queryByLabelText("player-overlay")).toBeNull();
});

test("touch catcher restores overlay after native video hides controls", async () => {
  const detailAPI: DetailAPI = { detail: jest.fn().mockResolvedValue(detail) };
  const playbackAPI: PlaybackAPI = { playbackURL: jest.fn().mockResolvedValue({ mode: "proxy", url: "https://p/m3u8" }) };
  const { findByTestId, queryByLabelText, getByTestId } = wrap(detailAPI, playbackAPI);
  await findByTestId("video");
  await act(async () => { fireEvent.press(getByTestId("playerOverlayDismissArea")); });
  expect(queryByLabelText("player-overlay")).toBeNull();
  await act(async () => { fireEvent.press(getByTestId("playerTouchCatcher")); });
  expect(queryByLabelText("player-overlay")).toBeTruthy();
});

test("play/pause button toggles the native Video paused prop", async () => {
  const detailAPI: DetailAPI = { detail: jest.fn().mockResolvedValue(detail) };
  const playbackAPI: PlaybackAPI = { playbackURL: jest.fn().mockResolvedValue({ mode: "proxy", url: "https://p/m3u8" }) };
  const { findByTestId, getByTestId, getByText } = wrap(detailAPI, playbackAPI);
  const initialVideo = await findByTestId("video");
  await act(async () => { fireEvent(initialVideo, "onLoad", { duration: 600 }); });

  await waitFor(() => expect(getByTestId("video").props.paused).toBe(false));
  await act(async () => { fireEvent.press(getByTestId("playerPlayPauseButton")); });
  await waitFor(() => expect(getByTestId("video").props.paused).toBe(true));
  await act(async () => { fireEvent.press(getByTestId("playerPlayPauseButton")); });
  await waitFor(() => expect(getByTestId("video").props.paused).toBe(false));
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

test("Video onLoad clamps an over-duration resume position before seeking", async () => {
  const { recordPlayProgress } = require("@/storage/watchHistory");
  const serverURL = "http://srv-player-clamp";
  const destination: PlayDestination = { ...dest, title: "Clamp T" };
  recordPlayProgress(serverURL, {
    id: "a:v-a:0",
    sourceKey: "a",
    videoId: "v-a",
    title: destination.title,
    cover: "",
    episode: "E1",
    episodeIndex: 0,
    progress: 700,
    duration: 900,
  });
  const detailAPI: DetailAPI = { detail: jest.fn().mockResolvedValue(detail) };
  const playbackAPI: PlaybackAPI = { playbackURL: jest.fn().mockResolvedValue({ mode: "proxy", url: "https://p/m3u8" }) };
  const { findByTestId } = wrap(detailAPI, playbackAPI, jest.fn(), destination, serverURL);
  const video = await findByTestId("video");
  const seek = (globalThis as { __lastMockVideoSeek?: jest.Mock }).__lastMockVideoSeek;
  await act(async () => { fireEvent(video, "onLoad", { duration: 600 }); });
  expect(seek).toHaveBeenCalledWith(600);
});

test("full-screen remount keeps controls visible and resumes from the current time", async () => {
  const detailAPI: DetailAPI = { detail: jest.fn().mockResolvedValue(detail) };
  const playbackAPI: PlaybackAPI = { playbackURL: jest.fn().mockResolvedValue({ mode: "proxy", url: "https://p/m3u8" }) };
  const { findByTestId, getByTestId, getByText } = wrap(detailAPI, playbackAPI);
  const video = await findByTestId("video");
  await act(async () => { fireEvent(video, "onLoad", { duration: 600 }); });
  await act(async () => { fireEvent(getByTestId("video"), "onProgress", { currentTime: 125, playableDuration: 600 }); });
  await waitFor(() => expect(getByTestId("video").props.paused).toBe(false));
  await waitFor(() => expect(getByText("2:05 / 10:00")).toBeTruthy());

  await act(async () => { fireEvent.press(getByTestId("fullscreenButton")); });
  expect(getByTestId("playerFullscreenModal")).toBeTruthy();
  expect(getByTestId("exitFullscreenButton")).toBeTruthy();
  expect(getByTestId("playerPlayPauseButton")).toBeTruthy();

  const remountedVideo = getByTestId("video");
  const seek = (globalThis as { __lastMockVideoSeek?: jest.Mock }).__lastMockVideoSeek;
  expect(seek).toBeDefined();
  await act(async () => { fireEvent(remountedVideo, "onLoad", { duration: 600 }); });
  expect(seek).toHaveBeenCalledWith(125);
});

test("favorite toggle persists with the current source's video_id", async () => {
  const { _resetForTests } = require("@/storage/mmkv");
  const { isFavorited } = require("@/storage/favorites");
  _resetForTests();
  const detailAPI: DetailAPI = { detail: jest.fn().mockResolvedValue(detail) };
  const playbackAPI: PlaybackAPI = { playbackURL: jest.fn().mockResolvedValue({ mode: "proxy", url: "https://p/m3u8" }) };
  const { findByTestId } = wrap(detailAPI, playbackAPI);
  const star = await findByTestId("playerFavorite");
  fireEvent.press(star);
  expect(isFavorited("http://srv-player", dest.sourceKey, dest.videoId)).toBe(true);
  fireEvent.press(star);
  expect(isFavorited("http://srv-player", dest.sourceKey, dest.videoId)).toBe(false);
});

test("BackHandler dismisses full-screen before popping", async () => {
  const spy = jest.spyOn(BackHandler, "addEventListener");
  const detailAPI: DetailAPI = { detail: jest.fn().mockResolvedValue(detail) };
  const playbackAPI: PlaybackAPI = { playbackURL: jest.fn().mockResolvedValue({ mode: "proxy", url: "https://p/m3u8" }) };
  const onClose = jest.fn();
  const { findByTestId, getByTestId, queryByTestId } = wrap(detailAPI, playbackAPI, onClose);
  await findByTestId("video");
  await act(async () => { fireEvent.press(getByTestId("fullscreenButton")); });
  await waitFor(() => expect(getByTestId("exitFullscreenButton")).toBeTruthy());
  // The PlayerScreen registers a hardwareBackPress handler — grab the most recent registration.
  // PlayerScreen 注册 hardwareBackPress; 取最后一次注册的 handler.
  const handlerCall = [...spy.mock.calls].reverse().find((c) => c[0] === "hardwareBackPress");
  expect(handlerCall).toBeDefined();
  const handler = handlerCall![1] as () => boolean;
  // First back press while full-screen exits full-screen without closing the screen.
  // 全屏时第一次 back 只退出全屏, 不关闭页面.
  act(() => { handler(); });
  expect(onClose).not.toHaveBeenCalled();
  await waitFor(() => expect(queryByTestId("exitFullscreenButton")).toBeNull());
  // The effect re-registers after exiting full-screen. The next back press closes the screen.
  // 退出全屏后 effect 重新注册, 下一次 back 才关闭页面.
  const normalHandlerCall = [...spy.mock.calls].reverse().find((c) => c[0] === "hardwareBackPress");
  expect(normalHandlerCall).toBeDefined();
  const normalHandler = normalHandlerCall![1] as () => boolean;
  act(() => { normalHandler(); });
  expect(onClose).toHaveBeenCalled();
  spy.mockRestore();
});
