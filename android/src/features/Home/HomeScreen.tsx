// HomeScreen composes HeroCarousel + ContinueWatchingRow + SectionRow, driven by useDoubanHomeQuery.
//
// HomeScreen 由 useDoubanHomeQuery 驱动, 组合 HeroCarousel + ContinueWatchingRow + SectionRow.

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { createAPIClient } from "@/api/client";
import { createDoubanAPI, type DoubanAPI } from "@/api/douban";
import { useDoubanHomeQuery } from "@/api/viewerHooks";
import { resolvePosterURL } from "@/designSystem/PosterImage";
import { Skeleton } from "@/designSystem/Skeleton";
import { sizes } from "@/designSystem/theme";
import { useTheme } from "@/designSystem/useTheme";
import type { HomeStackParamList } from "@/navigation/types";
import { useAuthStore } from "@/store/authStore";
import { useServerStore } from "@/store/serverStore";
import { useSync, useSyncList } from "@/sync/SyncContext";
import type { LocalRecord } from "@/sync/types";

import { ContinueWatchingRow } from "./ContinueWatchingRow";
import { HeroCarousel } from "./HeroCarousel";
import { SectionRow } from "./SectionRow";

/**
 * CONTINUE_WATCHING_LIMIT is the number of unfinished titles on the home row.
 *
 * CONTINUE_WATCHING_LIMIT 是首页继续观看行显示的未看完标题数量.
 */
export const CONTINUE_WATCHING_LIMIT = 10;

interface HomeScreenContextValue {
  api: DoubanAPI;
  /**
   * Optional callback so tests can stub the search button navigation without wrapping in
   * a NavigationContainer just to satisfy useNavigation. Production path supplies a navigate
   * call that pushes the Search screen with an empty initial query.
   *
   * 可选回调, 测试可桩化搜索按钮导航而无需用 NavigationContainer 包裹. 生产路径提供 push Search 屏的 navigate 调用.
   */
  onSearch?: () => void;
  /**
   * Mirrors iOS HomeView.navigateToSearch(SearchQuery(query: item.title, ...)). All card taps
   * (hero / continue / section) push the Search screen with the tapped title pre-filled.
   * Tests may override; production path navigates via useNavigation.
   *
   * 与 iOS HomeView.navigateToSearch(SearchQuery(query: item.title, ...)) 一致. 所有卡片点击
   * (hero / continue / section) 都把对应标题预填到 Search. 测试可覆盖, 生产走 useNavigation.
   */
  onSelectTitle?: (title: string) => void;
  onSelectHistory?: (entry: LocalRecord<"watch">) => void;
}

/**
 * Optional context lets integration tests inject a stubbed DoubanAPI without standing up
 * a full APIClient + serverStore. Production path falls back to useDefaultDoubanAPI().
 *
 * 可选 context 允许集成测试注入 stub DoubanAPI, 无需搭建完整 APIClient + serverStore.
 * 生产路径回退到 useDefaultDoubanAPI().
 */
export const HomeScreenContext = createContext<HomeScreenContextValue | null>(null);

/**
 * Build a default DoubanAPI from serverStore + authStore.
 *
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
 * Two render paths: context-driven (tests/embedded) and production. Splitting them keeps the
 * useNavigation call off the test path so tests don't need a NavigationContainer just for the
 * search button.
 *
 * HomeScreen — 由 useDoubanHomeQuery 驱动的 Hero 轮播 + 继续观看 + 分区行.
 * 两条渲染路径: context 驱动 (测试 / 嵌入) 与生产. 拆分让 useNavigation 只在生产路径调用, 测试无需为搜索按钮包 NavigationContainer.
 */
export function HomeScreen() {
  const ctx = useContext(HomeScreenContext);
  return ctx ? <ContextDrivenHomeScreen ctx={ctx} /> : <DefaultHomeScreen />;
}

function ContextDrivenHomeScreen({ ctx }: { ctx: HomeScreenContextValue }) {
  return (
    <HomeScreenInner
      api={ctx.api}
      onSearch={ctx.onSearch}
      onSelectTitle={ctx.onSelectTitle}
      onSelectHistory={ctx.onSelectHistory}
    />
  );
}

function DefaultHomeScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation("home");
  const defaultAPI = useDefaultDoubanAPI();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const onSearch = useCallback(
    () => navigation.navigate("Search", { initialQuery: "" }),
    [navigation],
  );
  const onSelectTitle = useCallback(
    (title: string) => navigation.navigate("Search", { initialQuery: title }),
    [navigation],
  );
  const onSelectHistory = useCallback(
    (entry: LocalRecord<"watch">) => {
      const p = entry.payload;
      navigation.navigate("Search", {
        initialQuery: p.title,
        resumeHint: {
          title: p.title,
          sourceKey: p.source_key,
          videoId: p.video_id,
          coverHint: p.cover,
          groupIndex: p.group_index,
          episodeIndex: p.episode_index,
          episodeName: p.episode,
        },
      });
    },
    [navigation],
  );

  const sync = useSync();
  const engine = sync.status === "ready" ? sync.engine : null;
  // The home tab stays mounted, so sync on every focus instead of only on mount.
  //
  // 首页 tab 会一直挂载, 因此每次获得焦点都同步, 而不只是挂载时同步.
  useFocusEffect(
    useCallback(() => {
      void engine?.requestSync("page");
    }, [engine]),
  );

  if (!defaultAPI) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bgPrimary }}>
        <Text style={{ color: colors.textSecondary }}>{t("error.generic")}</Text>
      </View>
    );
  }

  return (
    <HomeScreenInner
      api={defaultAPI}
      onSearch={onSearch}
      onSelectTitle={onSelectTitle}
      onSelectHistory={onSelectHistory}
    />
  );
}

function HomeScreenInner({
  api,
  onSearch,
  onSelectTitle,
  onSelectHistory,
}: {
  api: DoubanAPI;
  onSearch?: () => void;
  onSelectTitle?: (title: string) => void;
  onSelectHistory?: (entry: LocalRecord<"watch">) => void;
}) {
  const { colors } = useTheme();
	const { t } = useTranslation("home");
	const serverURL = useServerStore((s) => s.serverURL) ?? "";
	const insets = useSafeAreaInsets();

  const sync = useSync();
  const watchRecords = useSyncList("watch");
  // Continue watching shows the newest unfinished titles from the synced store.
  //
  // 继续观看显示同步存储中最新的未看完标题.
  const history = useMemo(
    () => watchRecords.filter((record) => !record.payload.completed).slice(0, CONTINUE_WATCHING_LIMIT),
    [watchRecords],
  );
  const query = useDoubanHomeQuery(api, serverURL);

  const handleClearHistory = useCallback(() => {
    if (sync.status === "ready") sync.store.clear("watch");
  }, [sync]);

  // Hero and section cards mirror iOS HomeView.navigateToSearch(SearchQuery(query: item.title, ...)).
  // Continue-watching cards also go through Search so stale sources are refreshed before Player opens.
  //
  // Hero 与 section 卡片对齐 iOS HomeView.navigateToSearch(SearchQuery(query: item.title, ...)).
  // 继续观看卡片也先进入 Search, 确保进 Player 前刷新过可用源.
  const selectByTitle = useCallback(
    (title: string) => onSelectTitle?.(title),
    [onSelectTitle],
  );
  const selectDoubanItem = useCallback(
    (item: { title: string }) => selectByTitle(item.title),
    [selectByTitle],
  );
  const selectHistoryItem = useCallback(
    (entry: LocalRecord<"watch">) => {
      if (onSelectHistory) {
        onSelectHistory(entry);
        return;
      }
      selectByTitle(entry.payload.title);
    },
    [onSelectHistory, selectByTitle],
  );

  const sections = query.data?.sections ?? [];
  const heroItems = useMemo(() => {
    const first = sections[0];
    if (!first) return [];
    return first.items.slice(0, 5);
  }, [sections]);

  // Prefetch hero + first 8 above-the-fold poster URLs. Fire-and-forget; expo-image
  // surfaces no rejection signal we can act on. Ref guards re-prefetching across rerenders.
  //
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
  //
  // 内联错误与 HomeView.swift line 79-82 对齐: 仅当无任何旧数据时才显示, 后台 refetch 失败
  // 不会覆盖已有有效数据.
  const showInlineError = query.isError && sections.length === 0 && heroItems.length === 0;

  // Top bar mirrors iOS HomeView.topBar: KMTV title + magnifying-glass search button.
  //
  // 顶栏与 iOS HomeView.topBar 一致: KMTV 标题 + 放大镜搜索按钮.
  const searchLabel = t("searchAria");
  const topBar = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingTop: insets.top + 12,
        paddingBottom: 8,
        backgroundColor: colors.bgPrimary,
      }}
    >
      <Text style={{ color: colors.textPrimary, fontSize: 22, fontWeight: "700", flex: 1 }}>
        {t("title")}
      </Text>
      {onSearch ? (
        <Pressable
          testID="homeSearchButton"
          accessibilityRole="button"
          accessibilityLabel={searchLabel}
          onPress={onSearch}
          style={({ pressed }) => ({
            opacity: pressed ? 0.6 : 1,
            padding: 8,
            borderRadius: 999,
            backgroundColor: colors.bgSecondary,
          })}
        >
          <Ionicons name="search" size={20} color={colors.textPrimary} />
        </Pressable>
      ) : null}
    </View>
  );

  if (query.isLoading) {
    return (
      <View testID="homeLoading" style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
        {topBar}
        <View style={{ paddingTop: 8 }}>
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
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bgPrimary }} contentContainerStyle={{ paddingBottom: 32 }}>
      {topBar}
      {showInlineError ? (
        <Text style={{ color: colors.textSecondary, paddingHorizontal: 16, paddingVertical: 12 }}>
          {t("error.generic")}
        </Text>
      ) : null}

      {heroItems.length > 0 ? (
        <HeroCarousel baseURL={serverURL} items={heroItems} onSelect={selectDoubanItem} />
      ) : null}

      <ContinueWatchingRow
        baseURL={serverURL}
        watchHistory={history}
        onClear={handleClearHistory}
        onSelect={selectHistoryItem}
      />

      {sections.map((s) => (
        <SectionRow key={s.name} baseURL={serverURL} section={s} onSelect={selectDoubanItem} />
      ))}
    </ScrollView>
  );
}
