// HomeScreen composes HeroCarousel + ContinueWatchingRow + SectionRow, driven by useDoubanHomeQuery.
// HomeScreen 由 useDoubanHomeQuery 驱动, 组合 HeroCarousel + ContinueWatchingRow + SectionRow.

import { Image } from "expo-image";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { createAPIClient } from "@/api/client";
import { createDoubanAPI, type DoubanAPI } from "@/api/douban";
import { useDoubanHomeQuery } from "@/api/viewerHooks";
import { resolvePosterURL } from "@/designSystem/PosterImage";
import { Skeleton } from "@/designSystem/Skeleton";
import { sizes } from "@/designSystem/theme";
import { useTheme } from "@/designSystem/useTheme";
import { useAuthStore } from "@/store/authStore";
import { useServerStore } from "@/store/serverStore";
import {
  clearWatchHistory,
  loadWatchHistory,
  type WatchHistoryItem,
} from "@/storage/watchHistory";

import { ContinueWatchingRow } from "./ContinueWatchingRow";
import { HeroCarousel } from "./HeroCarousel";
import { SectionRow } from "./SectionRow";

interface HomeScreenContextValue { api: DoubanAPI; }

/**
 * Optional context lets integration tests inject a stubbed DoubanAPI without standing up
 * a full APIClient + serverStore. Production path falls back to useDefaultDoubanAPI().
 * 可选 context 允许集成测试注入 stub DoubanAPI, 无需搭建完整 APIClient + serverStore.
 * 生产路径回退到 useDefaultDoubanAPI().
 */
export const HomeScreenContext = createContext<HomeScreenContextValue | null>(null);

/**
 * Build a default DoubanAPI from serverStore + authStore.
 * 由 serverStore + authStore 构建默认 DoubanAPI.
 */
function useDefaultDoubanAPI(): DoubanAPI | null {
  const serverURL = useServerStore((s) => s.serverURL);
  return useMemo(() => {
    if (!serverURL) return null;
    const client = createAPIClient({
      baseURL: serverURL,
      getToken: () => useAuthStore.getState().token,
      onUnauthorized: () => useAuthStore.getState().handleAuthExpired(),
    });
    return createDoubanAPI(client);
  }, [serverURL]);
}

/**
 * HomeScreen — Hero carousel + Continue Watching + Section rows, driven by useDoubanHomeQuery.
 * HomeScreen — 由 useDoubanHomeQuery 驱动的 Hero 轮播 + 继续观看 + 分区行.
 */
export function HomeScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation("home");
  const ctx = useContext(HomeScreenContext);
  const defaultAPI = useDefaultDoubanAPI();
  const api = ctx?.api ?? defaultAPI;

  if (!api) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bgPrimary }}>
        <Text style={{ color: colors.textSecondary }}>{t("error.generic")}</Text>
      </View>
    );
  }

  return <HomeScreenInner api={api} />;
}

function HomeScreenInner({ api }: { api: DoubanAPI }) {
  const { colors } = useTheme();
  const { t } = useTranslation("home");
  const serverURL = useServerStore((s) => s.serverURL) ?? "";

  // Local-first ordering mirrors HomeViewModel.load(): seed history from MMKV synchronously,
  // then fire the remote query. The useState initializer runs before useDoubanHomeQuery
  // is registered, so the first render already has local history visible.
  // 本地优先, 与 HomeViewModel.load() 一致: 先同步从 MMKV 读取历史, 再发起远端 query.
  // useState 初始化器先于 useDoubanHomeQuery 注册, 首次渲染已经显示本地历史.
  const [history, setHistory] = useState<WatchHistoryItem[]>(() => loadWatchHistory(serverURL));
  const query = useDoubanHomeQuery(api, serverURL);

  // Re-read MMKV when serverURL changes (e.g. user switched server mid-session).
  // 当 serverURL 切换时重新读取 MMKV (例如会话中切换 server).
  useEffect(() => {
    setHistory(loadWatchHistory(serverURL));
  }, [serverURL]);

  const handleClearHistory = useCallback(() => {
    clearWatchHistory(serverURL);
    setHistory([]);
  }, [serverURL]);

  // Detail navigation lands in M3/M4. For M2 the hero / continue / section taps are no-ops
  // so the layout is identical to iOS even before Search/Detail screens exist.
  // Detail 导航在 M3/M4 接入; M2 阶段 hero / continue / section 点击保持 no-op,
  // 使布局与 iOS 完全一致, 即便 Search/Detail 屏尚未实现.
  const noopSelect = useCallback(() => undefined, []);

  const sections = query.data?.sections ?? [];
  const heroItems = useMemo(() => {
    const first = sections[0];
    if (!first) return [];
    return first.items.slice(0, 5);
  }, [sections]);

  // Prefetch hero + first 8 above-the-fold poster URLs. Fire-and-forget; expo-image
  // surfaces no rejection signal we can act on. Ref guards re-prefetching across rerenders.
  // 预取 hero 与首屏分区前 8 张海报 URL. 触发即丢; ref 防止重渲染时重复预取.
  const prefetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!serverURL) return;
    const targets: string[] = [];
    for (const h of heroItems) {
      const url = resolvePosterURL(serverURL, h.cover);
      if (url && !prefetchedRef.current.has(url)) targets.push(url);
    }
    const firstNonHero = sections.find((_s, i) => i > 0);
    if (firstNonHero) {
      for (const it of firstNonHero.items.slice(0, 8)) {
        const url = resolvePosterURL(serverURL, it.cover);
        if (url && !prefetchedRef.current.has(url)) targets.push(url);
      }
    }
    if (targets.length === 0) return;
    targets.forEach((u) => prefetchedRef.current.add(u));
    void Image.prefetch(targets);
  }, [serverURL, heroItems, sections]);

  // Inline error mirrors HomeViewModel.swift / HomeView.swift line 79-82: only surface when
  // we have NO stale content to show. Background refetch failures behind valid data stay quiet.
  // 内联错误与 HomeView.swift line 79-82 对齐: 仅当无任何旧数据时才显示, 后台 refetch 失败
  // 不会覆盖已有有效数据.
  const showInlineError = query.isError && sections.length === 0 && heroItems.length === 0;

  if (query.isLoading) {
    return (
      <View testID="homeLoading" style={{ flex: 1, paddingTop: 16, backgroundColor: colors.bgPrimary }}>
        <Skeleton width={400} height={sizes.heroHeight} radius={0} />
        <View style={{ height: 16 }} />
        <Skeleton width={120} height={20} />
        <View style={{ flexDirection: "row", marginTop: 12 }}>
          <Skeleton width={sizes.cardWidth} height={sizes.cardWidth * 1.5} />
          <View style={{ width: 12 }} />
          <Skeleton width={sizes.cardWidth} height={sizes.cardWidth * 1.5} />
        </View>
        <ActivityIndicator style={{ marginTop: 12 }} color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bgPrimary }} contentContainerStyle={{ paddingBottom: 32 }}>
      {showInlineError ? (
        <Text style={{ color: colors.textSecondary, paddingHorizontal: 16, paddingVertical: 12 }}>
          {t("error.generic")}
        </Text>
      ) : null}

      {heroItems.length > 0 ? (
        <HeroCarousel baseURL={serverURL} items={heroItems} onSelect={noopSelect} />
      ) : null}

      <ContinueWatchingRow
        baseURL={serverURL}
        watchHistory={history}
        onClear={handleClearHistory}
        onSelect={noopSelect}
      />

      {sections.map((s) => (
        <SectionRow key={s.name} baseURL={serverURL} section={s} onSelect={noopSelect} />
      ))}
    </ScrollView>
  );
}
