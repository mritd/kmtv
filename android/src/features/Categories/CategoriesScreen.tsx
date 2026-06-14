// CategoriesScreen — tabs + sub/region chips + responsive poster grid driven by useDoubanRecommendInfiniteQuery.
// CategoriesScreen — tab + 子分类/地区胶囊 + 自适应海报网格, 由 useDoubanRecommendInfiniteQuery 驱动.

import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React, { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { createAPIClient } from "@/api/client";
import { createDoubanAPI, type DoubanAPI } from "@/api/douban";
import type { DoubanItem } from "@/api/types";
import { useCategoriesQuery, useDoubanRecommendInfiniteQuery } from "@/api/viewerHooks";
import { pickNumColumns as pickNumColumnsFromBreakpoints } from "@/designSystem/breakpoints";
import { LIST_PERF_GRID } from "@/designSystem/listPerf";
import { PosterImage } from "@/designSystem/PosterImage";
import { Skeleton } from "@/designSystem/Skeleton";
import { sizes } from "@/designSystem/theme";
import { useTheme } from "@/designSystem/useTheme";
import type { CategoriesStackParamList } from "@/navigation/types";
import { useAuthStore } from "@/store/authStore";
import { categoriesStore } from "@/store/categoriesStore";
import { useServerStore } from "@/store/serverStore";

import { CategoryChip } from "./CategoryChip";
import { resolveRecommendFilter, resolveSelection } from "./categoryFilter";
import { flattenCategoryPages } from "./categoryItems";

/**
 * Context lets tests inject a stub DoubanAPI + serverURL + onSearchTitle without booting
 * serverStore / authStore. Production path uses CategoriesScreen's default factory.
 * 测试可通过 context 注入 stub DoubanAPI + serverURL + onSearchTitle, 无需启动 serverStore / authStore.
 * 生产路径走 CategoriesScreen 的默认工厂.
 */
export interface CategoriesScreenContextValue {
  api: DoubanAPI;
  serverURL: string;
  onSearchTitle: (title: string) => void;
}

export const CategoriesScreenContext = createContext<CategoriesScreenContextValue | null>(null);

function useDefaultDoubanAPI(): { api: DoubanAPI | null; serverURL: string } {
  const serverURL = useServerStore((s) => s.serverURL) ?? "";
  const api = useMemo(() => {
    if (!serverURL) return null;
    const client = createAPIClient({
      baseURL: serverURL,
      getToken: () => useAuthStore.getState().token,
      onUnauthorized: () => useAuthStore.getState().handleAuthExpired(),
    });
    return createDoubanAPI(client);
  }, [serverURL]);
  return { api, serverURL };
}

/**
 * Re-export pickNumColumns from the shared breakpoints module so existing tests + callers
 * keep their `import { pickNumColumns } from "./CategoriesScreen"` paths working.
 * 从共享断点模块再导出 pickNumColumns, 保持现有测试与调用方的导入路径不变.
 */
export const pickNumColumns = pickNumColumnsFromBreakpoints;

function formatGridRating(rate?: string): string {
  const value = rate?.trim();
  return value && value !== "0" ? value : "N/A";
}

/**
 * CategoriesScreen — entry point exported to the navigator.
 * CategoriesScreen — 导出给导航器的入口组件.
 *
 * Two render paths: context-driven (tests + embedded) and production. Splitting them keeps
 * useNavigation off the test path so the test fixture is not forced to wrap in NavigationContainer
 * to satisfy a default it never uses.
 * 两条渲染路径: 由 context 驱动 (测试与嵌入) 与生产路径. 拆分两路径让 useNavigation 仅在生产路径调用,
 * 测试不再被强迫包 NavigationContainer 仅为满足一个用不到的默认行为.
 */
export function CategoriesScreen() {
  const ctx = useContext(CategoriesScreenContext);
  return ctx ? <ContextDrivenCategoriesScreen ctx={ctx} /> : <DefaultCategoriesScreen />;
}

function ContextDrivenCategoriesScreen({ ctx }: { ctx: CategoriesScreenContextValue }) {
  return <CategoriesScreenInner api={ctx.api} serverURL={ctx.serverURL} onSearchTitle={ctx.onSearchTitle} />;
}

function DefaultCategoriesScreen() {
  const { api, serverURL } = useDefaultDoubanAPI();
  const navigation = useNavigation<NativeStackNavigationProp<CategoriesStackParamList>>();
  const { colors } = useTheme();
  const { t } = useTranslation("categories");
  if (!api || !serverURL) {
    return (
      <View testID="categoriesUnconfigured" style={[styles.center, { backgroundColor: colors.bgPrimary }]}>
        <Text style={{ color: colors.textSecondary }}>{t("error.title")}</Text>
      </View>
    );
  }
  const onSearchTitle = (title: string) => navigation.navigate("Search", { initialQuery: title });
  return <CategoriesScreenInner api={api} serverURL={serverURL} onSearchTitle={onSearchTitle} />;
}

interface InnerProps {
  api: DoubanAPI;
  serverURL: string;
  onSearchTitle: (title: string) => void;
}

function CategoriesScreenInner({ api, serverURL, onSearchTitle }: InnerProps) {
  const { colors } = useTheme();
  const { t } = useTranslation("categories");
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const numColumns = pickNumColumns(width);
  const gridPadding = 16;
  const gridColumnGap = 10;
  const tileWidth = Math.floor((width - gridPadding * 2 - gridColumnGap * (numColumns - 1)) / numColumns);

  useEffect(() => {
    categoriesStore.getState().hydrate(serverURL);
  }, [serverURL]);

  const groupKey = categoriesStore((s) => s.groupKey);
  const subName = categoriesStore((s) => s.subName);
  const regionName = categoriesStore((s) => s.regionName);
  const selectGroup = categoriesStore((s) => s.selectGroup);
  const selectSub = categoriesStore((s) => s.selectSub);
  const selectRegion = categoriesStore((s) => s.selectRegion);

  const categoriesQuery = useCategoriesQuery(api, serverURL);
  const groups = useMemo(() => categoriesQuery.data?.categories ?? [], [categoriesQuery.data?.categories]);
  const resolved = useMemo(
    () => resolveSelection(groups, { groupKey, subName, regionName }),
    [groups, groupKey, subName, regionName],
  );
  const filter = useMemo(() => resolveRecommendFilter(resolved), [resolved]);

  const recommendQuery = useDoubanRecommendInfiniteQuery(api, serverURL, filter);
  const items = useMemo(
    () => flattenCategoryPages(recommendQuery.data?.pages),
    [recommendQuery.data?.pages],
  );

  const handleEndReached = useCallback(() => {
    if (recommendQuery.hasNextPage && !recommendQuery.isFetchingNextPage) {
      void recommendQuery.fetchNextPage();
    }
  }, [recommendQuery.hasNextPage, recommendQuery.isFetchingNextPage, recommendQuery.fetchNextPage]);

  if (categoriesQuery.isLoading) {
    return (
      <View testID="categoriesLoading" style={[styles.center, { backgroundColor: colors.bgPrimary }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (categoriesQuery.isError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bgPrimary, padding: 24 }]}>
        <Text style={[styles.errorTitle, { color: colors.textPrimary }]}>{t("error.title")}</Text>
        <Text style={[styles.errorBody, { color: colors.textSecondary }]}>{t("error.description")}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void categoriesQuery.refetch()}
          style={[styles.retryBtn, { backgroundColor: colors.accent }]}
        >
          <Text style={styles.retryText}>{t("retry")}</Text>
        </Pressable>
      </View>
    );
  }

  const activeGroup = resolved.group;
  const subs = activeGroup?.subcategories.filter((s) => s.name.length > 0) ?? [];
  const regions = activeGroup?.regions.filter((r) => r.name.length > 0) ?? [];

  return (
    <View style={[styles.root, { backgroundColor: colors.bgPrimary, paddingTop: insets.top }]}>
      <View style={styles.titleRow}>
        <Text style={[styles.screenTitle, { color: colors.textPrimary }]}>{t("title")}</Text>
      </View>
      <View style={[styles.tabBar, { borderBottomColor: colors.bgSecondary }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabScroll}
          contentContainerStyle={styles.tabRow}
        >
          {groups.map((group) => (
            <MainCategoryTab
              key={group.key}
              label={group.name}
              active={group.key === activeGroup?.key}
              onPress={() => selectGroup(group.key)}
              testID={`category-tab-${group.key}`}
            />
          ))}
        </ScrollView>
      </View>
      {subs.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          contentContainerStyle={styles.chipRow}
        >
          {subs.map((sub) => (
            <CategoryChip
              key={sub.name}
              label={sub.name}
              active={sub.name === resolved.sub?.name}
              onPress={() => selectSub(sub.name)}
            />
          ))}
        </ScrollView>
      ) : null}
      {regions.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.regionScroll}
          contentContainerStyle={styles.regionRow}
        >
          {regions.map((region) => (
            <CategoryChip
              key={region.name}
              label={region.name}
              active={region.name === resolved.region?.name}
              onPress={() => selectRegion(region.name)}
              variant="outline"
            />
          ))}
        </ScrollView>
      ) : null}
      <FlatList
        key={`grid-${numColumns}`}
        testID="categoryGrid"
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={numColumns}
        contentContainerStyle={[styles.gridContent, { paddingHorizontal: gridPadding }]}
        columnWrapperStyle={styles.gridRow}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.6}
        {...LIST_PERF_GRID}
        renderItem={({ item, index }) => (
          <PosterTile
            item={item}
            baseURL={serverURL}
            onPress={() => onSearchTitle(item.title)}
            titleColor={colors.textPrimary}
            metaColor={colors.textSecondary}
            tileWidth={tileWidth}
            marginRight={(index + 1) % numColumns === 0 ? 0 : gridColumnGap}
          />
        )}
        ListEmptyComponent={
          recommendQuery.isLoading ? null : (
            <View style={styles.emptyContainer}>
              <Text style={[styles.errorTitle, { color: colors.textPrimary }]}>{t("empty.title")}</Text>
              <Text style={[styles.errorBody, { color: colors.textSecondary }]}>{t("empty.description")}</Text>
            </View>
          )
        }
        ListFooterComponent={
          recommendQuery.hasNextPage ? (
            <View style={styles.loadMore}>
              <Skeleton width={120} height={18} />
              <Text style={[styles.loadMoreText, { color: colors.textSecondary }]}>{t("loadingMore")}</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

function MainCategoryTab(
  { label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID?: string },
) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      testID={testID}
      onPress={onPress}
      style={styles.mainTab}
    >
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={[
          styles.mainTabText,
          { color: active ? colors.accent : colors.textSecondary, fontWeight: active ? "600" : "400" },
        ]}
      >
        {label}
      </Text>
      <View style={[styles.mainTabIndicator, { backgroundColor: active ? colors.accent : "transparent" }]} />
    </Pressable>
  );
}

interface TileProps {
  item: DoubanItem;
  baseURL: string;
  onPress: () => void;
  titleColor: string;
  metaColor: string;
  tileWidth: number;
  marginRight: number;
}

function PosterTile({ item, baseURL, onPress, titleColor, metaColor, tileWidth, marginRight }: TileProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={[styles.tile, { width: tileWidth, marginRight }]}
    >
      <View style={styles.posterFrame}>
        <PosterImage baseURL={baseURL} cover={item.cover} style={styles.posterImg} />
        <View style={styles.badge}>
          <Text allowFontScaling={false} style={styles.badgeText}>{formatGridRating(item.rate)}</Text>
        </View>
      </View>
      <Text allowFontScaling={false} numberOfLines={2} style={[styles.title, { color: titleColor }]}>{item.title}</Text>
      {item.year ? (
        <Text allowFontScaling={false} style={[styles.meta, { color: metaColor }]} numberOfLines={1}>{item.year}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  titleRow: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  screenTitle: { fontSize: 28, fontWeight: "700" },
  tabBar: { borderBottomWidth: StyleSheet.hairlineWidth, paddingTop: 4 },
  tabScroll: { height: 40, maxHeight: 40, flexGrow: 0, flexShrink: 0 },
  tabRow: { paddingHorizontal: 0 },
  mainTab: { minWidth: 68, alignItems: "center" },
  mainTabText: {
    fontSize: 15,
    lineHeight: 20,
    includeFontPadding: false,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  mainTabIndicator: { height: 2, alignSelf: "stretch" },
  chipScroll: { height: 44, maxHeight: 44, flexGrow: 0, flexShrink: 0 },
  chipRow: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  regionScroll: { height: 36, maxHeight: 36, flexGrow: 0, flexShrink: 0 },
  regionRow: { paddingHorizontal: 16, paddingBottom: 8 },
  gridContent: { paddingBottom: 32 },
  gridRow: { justifyContent: "flex-start" },
  tile: { marginBottom: 16 },
  posterFrame: { aspectRatio: 2 / 3, borderRadius: sizes.radius.lg, overflow: "hidden", marginBottom: 4 },
  posterImg: { width: "100%", height: "100%" },
  badge: {
    position: "absolute", right: 4, top: 4,
    paddingHorizontal: 4, paddingVertical: 2, borderRadius: sizes.radius.sm,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
  },
  badgeText: { color: "rgb(74, 138, 245)", fontSize: 10, fontWeight: "700" },
  title: { fontSize: 12, lineHeight: 16, includeFontPadding: false, marginTop: 4 },
  meta: { fontSize: 11, lineHeight: 14, includeFontPadding: false, marginTop: 2 },
  errorTitle: { fontSize: 17, marginBottom: 6, fontWeight: "600" },
  errorBody: { fontSize: 15, textAlign: "center" },
  retryBtn: { marginTop: 16, paddingHorizontal: 18, paddingVertical: 10, borderRadius: sizes.radius.md },
  retryText: { color: "white", fontSize: 15 },
  emptyContainer: { paddingTop: 40, paddingHorizontal: 24, alignItems: "center" },
  loadMore: { paddingVertical: 16, alignItems: "center" },
  loadMoreText: { fontSize: 12, marginTop: 4 },
});
