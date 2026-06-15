// PlayerScreen — <Video /> + custom overlay + bottom bar + Modal full-screen + BackHandler.
// PlayerScreen — <Video /> + 自定义遮罩 + 底栏 + Modal 全屏 + BackHandler.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import {
  BackHandler, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Video, { ViewType } from "react-native-video";

import { createAPIClient } from "@/api/client";
import { createDetailAPI, type DetailAPI } from "@/api/detail";
import { createPlaybackAPI, type PlaybackAPI } from "@/api/playback";
import type { PlayDestination } from "@/api/types";
import { sizes } from "@/designSystem/theme";
import { useTheme } from "@/designSystem/useTheme";
import { setAndroidOrientation } from "@/native/screenOrientation";
import { useAuthStore } from "@/store/authStore";
import { useServerStore } from "@/store/serverStore";

import { CustomSlider } from "./CustomSlider";
import { EpisodeGrid } from "./EpisodeGrid";
import { episodes as selectEpisodes } from "./episodeSelection";
import { SkipSettingsRow } from "./SkipSettingsRow";
import { SourceSwitcher } from "./SourceSwitcher";
import { IconButton } from "@/designSystem/IconButton";

import { usePlayer } from "./usePlayer";
import { useFavoriteToggle } from "./useFavoriteToggle";

const OVERLAY_AUTO_HIDE_MS = 5000;
const SKIP_SECONDS = 10;
const PLAYBACK_RATES = [0.5, 1, 1.25, 1.5, 2, 3] as const;

function clampSeekSeconds(seconds: number, duration: number): number {
  const nonNegative = Math.max(0, seconds);
  return duration > 0 ? Math.min(nonNegative, duration) : nonNegative;
}

/**
 * Build a react-native-video source. Android ExoPlayer cannot infer HLS from the proxied
 * `/proxy/m3u8?...` path, so force the `m3u8` extension only for HLS URLs.
 * 构建 react-native-video source. Android ExoPlayer 无法从代理 `/proxy/m3u8?...` 路径推断 HLS,
 * 因此仅对 HLS URL 显式指定 `m3u8` extension.
 */
export function videoSourceForURL(uri: string): { uri: string; type?: string } {
  const withoutQuery = uri.split("?", 1)[0] ?? uri;
  const isHLS = withoutQuery.endsWith(".m3u8") || withoutQuery.endsWith("/proxy/m3u8");
  return isHLS ? { uri, type: "m3u8" } : { uri };
}

export function progressDurationFor(
  knownDuration: number,
  progress: { seekableDuration?: number },
): number {
  if (Number.isFinite(knownDuration) && knownDuration > 0) return knownDuration;
  const seekableDuration = progress.seekableDuration ?? 0;
  return Number.isFinite(seekableDuration) && seekableDuration > 0 ? seekableDuration : 0;
}

/**
 * Context value lets tests inject fake APIs + onClose without booting the store/navigation stack.
 * 通过 context 测试可注入 fake API 与 onClose, 无需启动 store/navigation.
 */
export interface PlayerScreenContextValue {
  detailAPI: DetailAPI;
  playbackAPI: PlaybackAPI;
  serverURL: string;
  onClose: () => void;
}

/**
 * Optional context — wired by tests; production reads serverStore + navigation directly.
 * 可选 context — 测试注入; 生产路径直接读 serverStore + navigation.
 */
export const PlayerScreenContext = createContext<PlayerScreenContextValue | null>(null);

function useDefaultContext(onClose: () => void): PlayerScreenContextValue | null {
  const serverURL = useServerStore((s) => s.serverURL) ?? "";
  const apis = useMemo(() => {
    if (!serverURL) return null;
    const client = createAPIClient({
      baseURL: serverURL,
      getToken: () => useAuthStore.getState().token,
      onUnauthorized: () => useAuthStore.getState().handleAuthExpired(),
    });
    return { detailAPI: createDetailAPI(client), playbackAPI: createPlaybackAPI(client) };
  }, [serverURL]);
  return apis && serverURL ? { ...apis, serverURL, onClose } : null;
}

/**
 * Props — wired from the Player route's params.
 * Props — 由 Player 路由参数传入.
 */
export interface PlayerScreenProps {
  route: { params: PlayDestination };
  navigation?: { goBack: () => void };
}

/**
 * PlayerScreen — composes <Video /> + overlay + bottom bar + Modal full-screen.
 * PlayerScreen — 组合 <Video /> + 遮罩 + 底栏 + Modal 全屏.
 */
export function PlayerScreen({ route, navigation }: PlayerScreenProps) {
  const goBack = navigation?.goBack ?? (() => undefined);
  const ctxFromProps = useContext(PlayerScreenContext);
  const fallback = useDefaultContext(goBack);
  const ctx = ctxFromProps ?? fallback;
  if (!ctx) return null;
  return <PlayerInner ctx={ctx} destination={route.params} />;
}

function PlayerInner({ ctx, destination }: { ctx: PlayerScreenContextValue; destination: PlayDestination }) {
  const { colors } = useTheme();
  const { t } = useTranslation("playback");
  const insets = useSafeAreaInsets();
  const { state, resumeStartSeconds, actions, stateRef } = usePlayer({
    serverURL: ctx.serverURL,
    destination,
    detailAPI: ctx.detailAPI,
    playbackAPI: ctx.playbackAPI,
  });
  const playbackURL = state.playbackURL;

  const [overlayVisible, setOverlayVisible] = useState(true);
  const [isFullScreen, setFullScreen] = useState(false);
  const [rateMenuVisible, setRateMenuVisible] = useState(false);
  const overlayHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<{ seek: (s: number) => void } | null>(null);
  const remountSeekSecondsRef = useRef<number | null>(null);
  // Track URL transitions so onLoad only consumes the resume target on the first new URL.
  // 跟踪 URL 变化, 让 onLoad 仅在新 URL 首次到达时消费续播位置.
  const lastUrlGenRef = useRef(0);

  const scheduleOverlayHide = useCallback(() => {
    if (overlayHideTimer.current) clearTimeout(overlayHideTimer.current);
    overlayHideTimer.current = setTimeout(() => setOverlayVisible(false), OVERLAY_AUTO_HIDE_MS);
  }, []);

  useEffect(() => {
    if (overlayVisible && !isFullScreen) scheduleOverlayHide();
    return () => { if (overlayHideTimer.current) clearTimeout(overlayHideTimer.current); };
  }, [isFullScreen, overlayVisible, scheduleOverlayHide]);

  useEffect(() => {
    if (!overlayVisible) setRateMenuVisible(false);
  }, [overlayVisible]);

  // Auto-start once detail is loaded and URL has not been resolved yet.
  // 详情加载完毕且未解析 URL 时自动起播.
  useEffect(() => {
    if (state.detail && !playbackURL) void actions.startPlayback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.detail]);

  // BackHandler — exit full-screen first, then close.
  // BackHandler — 优先退出全屏, 否则关闭.
  const setFullScreenPreservingPosition = useCallback((value: boolean) => {
    remountSeekSecondsRef.current = stateRef.current.currentTime;
    setOverlayVisible(true);
    setFullScreen(value);
  }, [stateRef]);

  useEffect(() => {
    setAndroidOrientation(isFullScreen ? "sensorLandscape" : "portrait");
    if (isFullScreen) {
      setOverlayVisible(true);
    }
    return () => {
      setAndroidOrientation("portrait");
    };
  }, [isFullScreen]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (isFullScreen) {
        setFullScreenPreservingPosition(false);
        return true;
      }
      ctx.onClose();
      return true;
    });
    return () => sub.remove();
  }, [ctx, isFullScreen, setFullScreenPreservingPosition]);

  // Persist progress on unmount.
  // 卸载时持久化进度.
  useEffect(() => () => { actions.persistProgressNow(); }, [actions]);

  const onSeekCommit = (ratio: number) => {
    const target = ratio * Math.max(state.duration, 1);
    videoRef.current?.seek(target);
    actions.commitSeek(target, state.duration);
  };

  const seekRelative = (deltaSeconds: number) => {
    const duration = stateRef.current.duration;
    const target = clampSeekSeconds(stateRef.current.currentTime + deltaSeconds, duration);
    videoRef.current?.seek(target);
    actions.commitSeek(target, duration);
  };

  const list = selectEpisodes(stateRef.current);

  const videoElement = playbackURL ? (
    <Video
      // Mock surfaces testID="video" and an imperative ref; production uses native ExoPlayer.
      // `key={urlGeneration}` forces a remount on every successful URL resolve so a transient
      // error followed by a same-URL retry actually re-initialises the player.
      // mock 暴露 testID="video" 与 imperative ref, 生产走原生 ExoPlayer.
      // `key={urlGeneration}` 每次成功解析都强制重挂, 瞬时错误后重试同一 URL 也能真正重启.
      key={state.urlGeneration}
      ref={videoRef as never}
      source={videoSourceForURL(playbackURL)}
      viewType={ViewType.TEXTURE}
      useTextureView
      pointerEvents="none"
      paused={!state.isPlaying}
      rate={state.playbackRate}
      onLoad={(meta: { duration: number }) => {
        const remountSeekSeconds = remountSeekSecondsRef.current;
        if (remountSeekSeconds !== null) {
          remountSeekSecondsRef.current = null;
          const target = clampSeekSeconds(remountSeekSeconds, meta.duration);
          if (target > 0) videoRef.current?.seek(target);
          actions.timeUpdate(target, meta.duration);
          actions.setPlaying(true);
          return;
        }
        // First onLoad for a freshly-resolved URL: seek to resumeStartSeconds (watchHistory +
        // skipIntro), mark the resume consumed, and seed currentTime/duration. Subsequent onLoad
        // events (Android's onLoad can fire after a rate / track change with the same URL) only
        // refresh duration so they don't yank the player back to the resume point.
        // 新 URL 的首个 onLoad: seek 到 resumeStartSeconds (watchHistory + skipIntro), 标记消费, 写入
        // currentTime / duration. 同 URL 的后续 onLoad (Android 上 rate / track 改变时可触发) 只更新
        // duration, 避免把进度拉回起点.
        if (state.urlGeneration !== lastUrlGenRef.current) {
          lastUrlGenRef.current = state.urlGeneration;
          const target = clampSeekSeconds(resumeStartSeconds, meta.duration);
          if (target > 0) videoRef.current?.seek(target);
          actions.markResumeConsumed();
          actions.timeUpdate(target, meta.duration);
        } else {
          const currentTime = clampSeekSeconds(stateRef.current.currentTime, meta.duration);
          if (currentTime > 0) videoRef.current?.seek(currentTime);
          actions.timeUpdate(currentTime, meta.duration);
        }
        actions.setPlaying(true);
      }}
      onProgress={(p: { currentTime: number; playableDuration?: number; seekableDuration?: number }) =>
        actions.timeUpdate(p.currentTime, progressDurationFor(stateRef.current.duration, p))}
      onError={() => { void actions.onError("player error"); }}
      onBuffer={(b: { isBuffering: boolean }) => actions.setBuffering(b.isBuffering)}
      onEnd={() => { void actions.switchEpisode(state.currentEpisodeIndex + 1); }}
      onTouchStart={() => setOverlayVisible(true)}
      resizeMode="contain"
      style={StyleSheet.absoluteFill}
    />
  ) : null;

  const playerControls = overlayVisible ? (
    <>
      <View
        testID="playerOverlayDismissArea"
        pointerEvents="none"
        style={styles.overlayScrim}
      />
      {isFullScreen ? (
        <Pressable
          testID="fullscreenBackButton"
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={ctx.onClose}
          style={({ pressed }) => [
            styles.fullscreenBackButton,
            { top: insets.top + 12, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="chevron-back" size={26} color="white" />
        </Pressable>
      ) : null}
      <View accessibilityLabel="player-overlay" pointerEvents="box-none" style={[styles.overlay, isFullScreen ? styles.fullscreenOverlay : null]}>
        <Pressable
          testID="playerSkipBackwardButton"
          accessibilityRole="button"
          accessibilityLabel={t("skipBackward")}
          onPress={() => seekRelative(-SKIP_SECONDS)}
          style={styles.transportBtn}
        >
          <Ionicons name="play-back" size={18} color="white" />
        </Pressable>
        <Pressable
          testID="playerPlayPauseButton"
          accessibilityRole="button"
          accessibilityLabel={state.isPlaying ? t("pause") : t("play")}
          onPress={() => actions.setPlaying(!state.isPlaying)}
          style={styles.transportBtnPrimary}
        >
          <Ionicons name={state.isPlaying ? "pause" : "play"} size={24} color="white" />
        </Pressable>
        <Pressable
          testID="playerSkipForwardButton"
          accessibilityRole="button"
          accessibilityLabel={t("skipForward")}
          onPress={() => seekRelative(SKIP_SECONDS)}
          style={styles.transportBtn}
        >
          <Ionicons name="play-forward" size={18} color="white" />
        </Pressable>
      </View>
      <View style={[styles.bottomBar, isFullScreen ? styles.fullscreenBottomBar : null]}>
        <Text style={styles.timecode}>{formatTime(state.currentTime)} / {formatTime(state.duration)}</Text>
        <View testID="progressSlot" style={[styles.progressSlot, isFullScreen ? styles.fullscreenProgressSlot : null]}>
          <CustomSlider
            value={state.duration > 0 ? state.currentTime / state.duration : 0}
            onDragStart={() => actions.setSeeking(true)}
            onDragEnd={onSeekCommit}
            testID="progressSlider"
          />
        </View>
        <View style={styles.rateMenuAnchor}>
          {rateMenuVisible ? (
            <View testID="rateMenu" style={styles.rateMenu}>
              {PLAYBACK_RATES.map((rate) => {
                const active = rate === state.playbackRate;
                return (
                  <Pressable
                    key={rate}
                    testID={`rateOption-${rate}`}
                    accessibilityRole="menuitem"
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      actions.setRate(rate);
                      setRateMenuVisible(false);
                    }}
                    style={[styles.rateOption, active ? styles.rateOptionActive : null]}
                  >
                    <Text style={[styles.rateOptionText, active ? styles.rateOptionTextActive : null]}>
                      {rate}x
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <Pressable
            testID="rateMenuButton"
            accessibilityRole="button"
            accessibilityLabel="rateMenu"
            accessibilityState={{ expanded: rateMenuVisible }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => setRateMenuVisible((v) => !v)}
            style={styles.rateButton}
          >
            <Text style={styles.iconText}>{state.playbackRate}x</Text>
            <Ionicons name={rateMenuVisible ? "chevron-down" : "chevron-up"} size={14} color="white" />
          </Pressable>
        </View>
        <Pressable
          testID={isFullScreen ? "exitFullscreenButton" : "fullscreenButton"}
          accessibilityRole="button"
          accessibilityLabel={isFullScreen ? t("exitFullscreen") : t("fullscreen")}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => {
            setFullScreenPreservingPosition(!isFullScreen);
          }}
          style={styles.iconBtn}
        >
          <Ionicons name={isFullScreen ? "contract-outline" : "expand-outline"} size={20} color="white" />
        </Pressable>
      </View>
    </>
  ) : null;

  const playerSurface = (
    <View testID="playerSurface" style={[styles.surface, { backgroundColor: "black" }]}>
      {videoElement}
    </View>
  );

  const playerFrame = (
    <View style={[styles.playerFrame, isFullScreen ? styles.fullscreenFrame : styles.inlineFrame]}>
      {playerSurface}
      {!overlayVisible ? (
        <Pressable
          testID="playerTouchCatcher"
          accessibilityRole="button"
          accessibilityLabel={t("showControls")}
          onPress={() => setOverlayVisible(true)}
          style={styles.touchCatcher}
        />
      ) : null}
      {playerControls}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPrimary, paddingTop: insets.top }}>
      <Pressable
        testID="playerBackButton"
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={ctx.onClose}
        style={({ pressed }) => [
          styles.backButton,
          { top: insets.top + 8, backgroundColor: "rgba(0, 0, 0, 0.42)", opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Ionicons name="chevron-back" size={24} color="white" />
      </Pressable>
      <ScrollView
        testID="playerDetailsScroll"
        style={styles.detailsScroll}
        contentContainerStyle={[styles.detailsContent, { paddingBottom: Math.max(insets.bottom, 12) + 92 }]}
        showsVerticalScrollIndicator={false}
      >
        {isFullScreen ? null : playerFrame}
        <PlayerTitleRow
          title={state.detail?.title ?? destination.title}
          subtitle={state.detail ? [state.detail.type, state.detail.year].filter(Boolean).join(" · ") : ""}
          serverURL={ctx.serverURL}
          currentSourceKey={state.currentSourceKey}
          currentVideoID={
            state.sources.find((s) => s.source_key === state.currentSourceKey)?.video_id ?? destination.videoId
          }
          cover={state.detail?.cover ?? destination.coverHint}
          type={state.detail?.type ?? ""}
          year={state.detail?.year ?? ""}
        />
        {state.sources.length > 1 ? (
          <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
            <SourceSwitcher sources={state.sources} currentKey={state.currentSourceKey} onSelect={(k) => void actions.switchSource(k)} />
          </View>
        ) : null}
        {(state.detail?.episodes.length ?? 0) > 1 ? (
          <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 6 }}>{t("cdnLines")}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {(state.detail?.episodes ?? []).map((line, idx) => {
                // Dead line (empty inner array) — show strike-through and disable per spec §7.
                // 死线路 (内层数组为空) — 按 spec §7 加划线并禁用.
                const dead = line.length === 0;
                const isCurrent = idx === state.currentLineIndex;
                return (
                  <Pressable
                    key={`line-${idx}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isCurrent, disabled: dead }}
                    disabled={dead}
                    onPress={() => void actions.switchLine(idx)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      marginRight: 6,
                      marginBottom: 6,
                      borderRadius: sizes.radius.sm,
                      backgroundColor: isCurrent ? colors.accent : colors.bgCard,
                      opacity: dead ? 0.5 : 1,
                    }}
                  >
                    <Text style={{
                      color: isCurrent ? "white" : colors.textPrimary,
                      fontSize: 11,
                      textDecorationLine: dead ? "line-through" : "none",
                    }}>
                      {t(dead ? "lineDead" : "line", { index: idx + 1 })}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
        <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
          <SkipSettingsRow
            skipIntroSeconds={state.skipIntroSeconds}
            skipOutroSeconds={state.skipOutroSeconds}
            onChangeIntro={actions.setSkipIntro}
            onChangeOutro={actions.setSkipOutro}
          />
        </View>
        {list.length > 1 ? (
          <View style={{ paddingHorizontal: 16 }}>
            <EpisodeGrid episodes={list} currentIndex={state.currentEpisodeIndex} onSelect={(i) => void actions.switchEpisode(i)} />
          </View>
        ) : null}
      </ScrollView>
      <Modal visible={isFullScreen} onRequestClose={() => setFullScreenPreservingPosition(false)} animationType="fade">
        <View testID="playerFullscreenModal" style={styles.fullscreenRoot}>
          {isFullScreen ? playerFrame : null}
        </View>
      </Modal>
    </View>
  );
}

interface PlayerTitleRowProps {
  title: string;
  subtitle: string;
  serverURL: string;
  currentSourceKey: string;
  currentVideoID: string;
  cover: string;
  type: string;
  year: string;
}

/**
 * PlayerTitleRow — title + subtitle below the video surface plus a favorite star.
 * PlayerTitleRow — 视频面板下方的标题、副标题与收藏星.
 */
function PlayerTitleRow({ title, subtitle, serverURL, currentSourceKey, currentVideoID, cover, type, year }: PlayerTitleRowProps) {
  const { colors } = useTheme();
  const { favorited, toggle } = useFavoriteToggle({
    serverURL,
    item: { sourceKey: currentSourceKey, videoId: currentVideoID, title, cover, type, year },
  });
  return (
    <View style={{ padding: 16, flexDirection: "row", alignItems: "flex-start", gap: 4 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.textPrimary, fontSize: 15, fontWeight: "700" }}>{title}</Text>
        {subtitle ? (
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>{subtitle}</Text>
        ) : null}
      </View>
      <IconButton
        testID="playerFavorite"
        name={favorited ? "star" : "star-outline"}
        active={favorited}
        onPress={toggle}
        accessibilityLabel={favorited ? "favorited" : "favorite"}
      />
    </View>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

const styles = StyleSheet.create({
  playerFrame: { position: "relative", overflow: "hidden", backgroundColor: "black" },
  inlineFrame: { width: "100%", aspectRatio: 16 / 9 },
  fullscreenFrame: { flex: 1, width: "100%" },
  surface: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  detailsScroll: { flex: 1 },
  detailsContent: { flexGrow: 1 },
  touchCatcher: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 2, elevation: 8 },
  backButton: {
    position: "absolute",
    left: 16,
    zIndex: 10,
    elevation: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  overlayScrim: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 2, backgroundColor: "rgba(0,0,0,0.35)" },
  fullscreenBackButton: { position: "absolute", left: 16, zIndex: 5, elevation: 16, width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.42)" },
  overlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 32, zIndex: 3, elevation: 10, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 12 },
  fullscreenOverlay: { bottom: 88 },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 4, elevation: 12, overflow: "visible", paddingHorizontal: 12, paddingVertical: 6, flexDirection: "row", alignItems: "center", backgroundColor: "rgba(0,0,0,0.55)" },
  fullscreenBottomBar: { left: 16, right: 16, bottom: 18, minHeight: 48, borderRadius: 8 },
  progressSlot: { flex: 1, flexShrink: 1, minWidth: 0, marginHorizontal: 8 },
  fullscreenProgressSlot: { marginHorizontal: 10 },
  timecode: { color: "white", fontSize: 11 },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  iconText: { color: "white", fontSize: 13, fontWeight: "700" },
  transportBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  transportBtnPrimary: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.24)",
  },
  rateMenuAnchor: { position: "relative", zIndex: 6 },
  rateButton: {
    width: 62,
    height: 44,
    paddingHorizontal: 8,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  rateMenu: {
    position: "absolute",
    right: 0,
    bottom: 42,
    width: 86,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(22,22,28,0.96)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
    elevation: 12,
  },
  rateOption: { height: 32, paddingHorizontal: 10, justifyContent: "center" },
  rateOptionActive: { backgroundColor: "rgba(100,149,237,0.32)" },
  rateOptionText: { color: "white", fontSize: 13, fontWeight: "600" },
  rateOptionTextActive: { color: "white" },
  fullscreenRoot: {
    flex: 1,
    backgroundColor: "black",
    justifyContent: "center",
  },
});
