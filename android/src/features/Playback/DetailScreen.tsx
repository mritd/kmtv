// DetailScreen — info hero + source picker + episode grid + Play CTA. M4 root for Detail navigation.
// DetailScreen — 信息头图 + 源选择器 + 剧集网格 + 播放按钮. M4 中 Detail 导航的根组件.

import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { createAPIClient } from "@/api/client";
import { createDetailAPI, type DetailAPI } from "@/api/detail";
import type { PlayDestination, VideoDetail } from "@/api/types";
import { useLayoutWidth } from "@/designSystem/breakpoints";
import { IconButton } from "@/designSystem/IconButton";
import { PosterImage } from "@/designSystem/PosterImage";
import { Skeleton } from "@/designSystem/Skeleton";
import { sizes } from "@/designSystem/theme";
import { useTheme } from "@/designSystem/useTheme";
import { useAuthStore } from "@/store/authStore";
import { useServerStore } from "@/store/serverStore";

import { EpisodeGrid } from "./EpisodeGrid";
import { SourceSwitcher } from "./SourceSwitcher";
import { useFavoriteToggle } from "./useFavoriteToggle";

/**
 * Context value lets tests inject a stub DetailAPI + onPlay handler without booting the store stack.
 * 通过 context 测试可注入 stub DetailAPI 与 onPlay 回调, 无需启动 store.
 */
export interface DetailScreenContextValue {
  detailAPI: DetailAPI;
  serverURL: string;
  onPlay: (destination: PlayDestination) => void;
  onBack?: () => void;
}

/**
 * Optional context — wired by tests; production reads serverStore + navigation directly.
 * 可选 context — 测试注入; 生产路径直接读 serverStore + navigation.
 */
export const DetailScreenContext = createContext<DetailScreenContextValue | null>(null);

function useDefaultContext(
  navigation: { navigate: (route: "Player", params: PlayDestination) => void; goBack?: () => void } | undefined,
): DetailScreenContextValue | null {
  const serverURL = useServerStore((s) => s.serverURL) ?? "";
  const api = useMemo(() => {
    if (!serverURL) return null;
    const client = createAPIClient({
      baseURL: serverURL,
      getToken: () => useAuthStore.getState().token,
      onUnauthorized: () => useAuthStore.getState().handleAuthExpired(),
    });
    return createDetailAPI(client);
  }, [serverURL]);
  if (!api || !serverURL) return null;
  return {
    detailAPI: api,
    serverURL,
    onPlay: (dest) => navigation?.navigate("Player", dest),
    onBack: navigation?.goBack,
  };
}

/**
 * DetailScreen props — Detail route params shaped by HomeStack/CategoriesStack.
 * DetailScreen props — HomeStack/CategoriesStack 提供的 Detail 路由参数.
 */
export interface DetailScreenProps {
  route: { params: PlayDestination };
  navigation?: { navigate: (route: "Player", params: PlayDestination) => void; goBack?: () => void };
}

/**
 * DetailScreen — entry component for the Detail route.
 * DetailScreen — Detail 路由的入口组件.
 */
export function DetailScreen({ route, navigation }: DetailScreenProps) {
  const ctxFromProps = useContext(DetailScreenContext);
  const fallback = useDefaultContext(navigation);
  const ctx = ctxFromProps ?? fallback;
  if (!ctx) return null;
  return <DetailInner ctx={ctx} destination={route.params} />;
}

function DetailInner({ ctx, destination }: { ctx: DetailScreenContextValue; destination: PlayDestination }) {
  const { colors } = useTheme();
  const { t } = useTranslation("playback");
  const layout = useLayoutWidth();
  const insets = useSafeAreaInsets();
  const isTablet = layout !== "phone";
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [sources, setSources] = useState(destination.sources);
  const [currentSourceKey, setCurrentSourceKey] = useState(destination.sourceKey);
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState(destination.resumeIntent?.episodeIndex ?? 0);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const d = await ctx.detailAPI.detail(currentSourceKey, destination.videoId);
        if (!cancelled) setDetail(d);
      } catch (err) {
        if (!cancelled) setErrorMessage(err instanceof Error ? err.message : "load failed");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const episodes = useMemo(
    () => detail?.episodes[0] ?? sources.find((s) => s.source_key === currentSourceKey)?.episodes ?? [],
    [detail, sources, currentSourceKey],
  );

  const activeSource = sources.find((s) => s.source_key === currentSourceKey);
  const { favorited, toggle: toggleFavorite } = useFavoriteToggle({
    serverURL: ctx.serverURL,
    item: {
      sourceKey: currentSourceKey,
      videoId: activeSource?.video_id ?? destination.videoId,
      title: detail?.title ?? destination.title,
      cover: detail?.cover ?? destination.coverHint,
      type: detail?.type ?? "",
      year: detail?.year ?? "",
    },
  });

  const onSwitchSource = async (sourceKey: string) => {
    const next = sources.find((s) => s.source_key === sourceKey);
    if (!next) return;
    setCurrentSourceKey(sourceKey);
    try {
      const d = await ctx.detailAPI.detail(sourceKey, next.video_id);
      setDetail(d);
    } catch (err) {
      setSources((s) => s.filter((x) => x.source_key !== sourceKey));
      setErrorMessage(err instanceof Error ? err.message : "switch source failed");
    }
  };

  // onPlay accepts an explicit episode index so EpisodeGrid clicks don't race against
  // setCurrentEpisodeIndex's commit. videoId is looked up from the active source so a source
  // switch propagates the right videoId — `...destination` would carry the original one.
  // onPlay 显式接收剧集索引, 避免 EpisodeGrid 点击与 setCurrentEpisodeIndex 提交竞态.
  // videoId 从当前源查 (而非 `...destination`), 切源后 videoId 才能跟着变.
  const onPlay = (episodeIndex: number) => {
    const activeSource = sources.find((s) => s.source_key === currentSourceKey);
    const dest: PlayDestination = {
      title: detail?.title ?? destination.title,
      sources,
      sourceKey: currentSourceKey,
      videoId: activeSource?.video_id ?? destination.videoId,
      coverHint: detail?.cover ?? destination.coverHint,
      resumeIntent: { episodeIndex, episodeName: episodes[episodeIndex]?.name ?? "" },
    };
    ctx.onPlay(dest);
  };

  if (!detail) {
    return (
      <View testID="detailLoading" style={[styles.center, { backgroundColor: colors.bgPrimary }]}>
        <Skeleton width={250} height={375} />
        <ActivityIndicator color={colors.accent} style={{ marginTop: 16 }} />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bgPrimary }} contentContainerStyle={styles.scrollContent}>
      <View style={styles.heroBg}>
        <PosterImage baseURL={ctx.serverURL} cover={detail.cover} style={styles.bgImage} />
        <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
      </View>
      {ctx.onBack ? (
        <Pressable
          testID="detailBackButton"
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={ctx.onBack}
          style={({ pressed }) => [
            styles.backButton,
            { top: insets.top + 8, backgroundColor: "rgba(0, 0, 0, 0.38)", opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="chevron-back" size={24} color="white" />
        </Pressable>
      ) : null}
      <View
        style={[
          styles.heroBase,
          { paddingTop: insets.top + 48 },
          isTablet ? styles.heroRow : styles.heroStack,
        ]}
        testID="detailHero"
      >
        <View testID="detailPoster" style={isTablet ? styles.posterTablet : styles.posterPhone}>
          <PosterImage baseURL={ctx.serverURL} cover={detail.cover} style={{ width: "100%", height: "100%" }} />
        </View>
        <View style={isTablet ? styles.infoTablet : styles.infoPhone}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: colors.textPrimary, flex: 1 }]} numberOfLines={2}>{detail.title}</Text>
            <IconButton
              testID="detailFavorite"
              name={favorited ? "star" : "star-outline"}
              active={favorited}
              onPress={toggleFavorite}
              accessibilityLabel={favorited ? "favorited" : "favorite"}
            />
          </View>
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
            {[detail.type, detail.year, detail.area].filter(Boolean).join(" · ")}
          </Text>
          {detail.director ? (
            <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 4 }} numberOfLines={1}>
              {detail.director}
            </Text>
          ) : null}
          {detail.actor ? (
            <Text style={{ color: colors.textSecondary, fontSize: 11 }} numberOfLines={2}>
              {detail.actor}
            </Text>
          ) : null}
          <Pressable
            onPress={() => onPlay(currentEpisodeIndex)}
            accessibilityRole="button"
            style={[styles.playBtn, { backgroundColor: colors.accent }]}
          >
            <Text style={{ color: "white", fontSize: 15, fontWeight: "700" }}>{t("play")}</Text>
          </Pressable>
          {isTablet && detail.desc ? (
            <Text style={[styles.descInline, { color: colors.textSecondary }]} numberOfLines={6}>
              {detail.desc}
            </Text>
          ) : null}
        </View>
      </View>
      {!isTablet && detail.desc ? (
        <Text style={[styles.desc, { color: colors.textSecondary }]} numberOfLines={6}>
          {detail.desc}
        </Text>
      ) : null}
      {sources.length > 1 ? (
        <View style={{ paddingHorizontal: 16, marginTop: 16 }}>
          <Text style={[styles.section, { color: colors.textPrimary }]}>{t("sources")}</Text>
          <SourceSwitcher sources={sources} currentKey={currentSourceKey} onSelect={onSwitchSource} />
        </View>
      ) : null}
      {episodes.length > 1 ? (
        <View style={{ paddingHorizontal: 16, marginTop: 16 }}>
          <Text style={[styles.section, { color: colors.textPrimary }]}>{t("episodes")}</Text>
          <EpisodeGrid
            episodes={episodes}
            currentIndex={currentEpisodeIndex}
            onSelect={(i) => { setCurrentEpisodeIndex(i); onPlay(i); }}
          />
        </View>
      ) : null}
      {errorMessage ? (
        <Text style={{ color: colors.textPrimary, padding: 16 }}>{errorMessage}</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scrollContent: { paddingBottom: 32 },
  heroBg: { position: "absolute", left: 0, right: 0, top: 0, height: 360, opacity: 0.5 },
  bgImage: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  backButton: {
    position: "absolute",
    left: 16,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  heroBase: { padding: 16 },
  heroStack: { flexDirection: "column", alignItems: "center" },
  heroRow: { flexDirection: "row", alignItems: "flex-start" },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 4 },
  posterPhone: { width: 110, height: 165, borderRadius: sizes.radius.md, overflow: "hidden", marginBottom: 12 },
  posterTablet: { width: 200, height: 300, borderRadius: sizes.radius.md, overflow: "hidden", marginRight: 16 },
  infoPhone: { width: "100%", alignItems: "stretch" },
  infoTablet: { flex: 1 },
  title: { fontSize: 19, fontWeight: "800" },
  desc: { paddingHorizontal: 16, fontSize: 12, lineHeight: 18, marginTop: 8 },
  descInline: { fontSize: 12, lineHeight: 18, marginTop: 12 },
  section: { fontSize: 15, fontWeight: "700", marginBottom: 8 },
  playBtn: { marginTop: 12, paddingHorizontal: 18, paddingVertical: 8, borderRadius: sizes.radius.md, alignSelf: "flex-start" },
});
