// SearchScreen — input + SSE-driven streaming search + sync fallback + server-scoped history chips.
// SearchScreen — 输入框 + SSE 流式搜索 + 同步回退 + 按服务器隔离的历史胶囊.

import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";

import { createAPIClient } from "@/api/client";
import { createSearchAPI, type SearchAPI } from "@/api/search";
import type { PlayDestination, SearchProgress, SearchResult } from "@/api/types";
import { useLayoutWidth } from "@/designSystem/breakpoints";
import { LIST_PERF_DEFAULT } from "@/designSystem/listPerf";
import { PosterImage } from "@/designSystem/PosterImage";
import { sizes } from "@/designSystem/theme";
import { useTheme } from "@/designSystem/useTheme";
import type { HomeStackParamList, SearchRouteParams } from "@/navigation/types";
import { useAuthStore } from "@/store/authStore";
import { useServerStore } from "@/store/serverStore";
import {
  addSearchHistory, clearSearchHistory, loadSearchHistory, type SearchHistoryItem,
} from "@/storage/searchHistory";

import { SearchHistoryFlow } from "./SearchHistoryFlow";

export interface SearchScreenContextValue {
  api: SearchAPI;
  serverURL: string;
}

export const SearchScreenContext = createContext<SearchScreenContextValue | null>(null);

function useDefaultSearchAPI(): { api: SearchAPI | null; serverURL: string } {
  const serverURL = useServerStore((s) => s.serverURL) ?? "";
  const api = useMemo(() => {
    if (!serverURL) return null;
    const client = createAPIClient({
      baseURL: serverURL,
      getToken: () => useAuthStore.getState().token,
      onUnauthorized: () => useAuthStore.getState().handleAuthExpired(),
    });
    return createSearchAPI(client, () => useAuthStore.getState().token);
  }, [serverURL]);
  return { api, serverURL };
}

type Status = "idle" | "loading" | "success" | "error";

interface State {
  query: string;
  submitted: string;
  status: Status;
  results: SearchResult[];
  progress: Partial<Record<"searching" | "probing", SearchProgress>>;
  errorMessage: string;
  history: SearchHistoryItem[];
}

type Action =
  | { type: "setQuery"; value: string }
  | { type: "submit"; query: string }
  | { type: "progress"; payload: SearchProgress }
  | { type: "success"; results: SearchResult[] }
  | { type: "error"; message: string }
  | { type: "setHistory"; items: SearchHistoryItem[] }
  | { type: "reset"; query: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "setQuery": return { ...state, query: action.value };
    case "reset": return {
      ...state, query: action.query, submitted: "", status: "idle",
      results: [], progress: {}, errorMessage: "",
    };
    case "submit": return { ...state, submitted: action.query, status: "loading", results: [], progress: {}, errorMessage: "" };
    case "progress": {
      const phase = action.payload.phase;
      if (phase !== "searching" && phase !== "probing") return state;
      return { ...state, progress: { ...state.progress, [phase]: action.payload } };
    }
    case "success": return { ...state, status: "success", results: action.results };
    case "error": return { ...state, status: "error", errorMessage: action.message };
    case "setHistory": return { ...state, history: action.items };
    default: return state;
  }
}

export interface SearchScreenProps {
  route?: { key?: string; name?: string; params?: SearchRouteParams };
}

/**
 * SearchScreen — entry point exported to the per-tab native-stack.
 * SearchScreen — 导出给各 Tab 内 native-stack 的入口组件.
 */
export function SearchScreen({ route }: SearchScreenProps) {
  const ctx = useContext(SearchScreenContext);
  const fallback = useDefaultSearchAPI();
  const api = ctx?.api ?? fallback.api;
  const serverURL = ctx?.serverURL ?? fallback.serverURL;
  const { colors } = useTheme();
  const { t } = useTranslation("search");

  if (!api || !serverURL) {
    return (
      <View testID="searchUnconfigured" style={[styles.center, { backgroundColor: colors.bgPrimary }]}>
        <Text style={{ color: colors.textSecondary }}>{t("error.generic")}</Text>
      </View>
    );
  }
  return <Inner api={api} serverURL={serverURL} initialQuery={route?.params?.initialQuery ?? ""} />;
}

interface InnerProps { api: SearchAPI; serverURL: string; initialQuery: string }

function Inner({ api, serverURL, initialQuery }: InnerProps) {
  const { colors } = useTheme();
  const { t } = useTranslation("search");
  const layout = useLayoutWidth();
  const isTablet = layout !== "phone";
  // HomeStackParamList and CategoriesStackParamList both define "Detail" with PlayDestination,
  // so typing as HomeStackParamList here works whether SearchScreen is mounted under either tab.
  // HomeStackParamList 与 CategoriesStackParamList 的 Detail 都指向 PlayDestination, 在此用 HomeStackParamList
  // 类型化即可同时覆盖两个 Tab 的导航类型.
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const [state, dispatch] = useReducer(reducer, {
    query: initialQuery,
    submitted: "",
    status: "idle",
    results: [],
    progress: {},
    errorMessage: "",
    history: loadSearchHistory(serverURL),
  });
  const controllerRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    dispatch({ type: "submit", query: trimmed });
    addSearchHistory(serverURL, trimmed);
    dispatch({ type: "setHistory", items: loadSearchHistory(serverURL) });

    try {
      const response = await api.searchStream(
        trimmed,
        (progress) => {
          if (controller.signal.aborted) return;
          dispatch({ type: "progress", payload: progress });
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      dispatch({ type: "success", results: response.results });
    } catch {
      if (controller.signal.aborted) return;
      // SSE failed → fall back to sync search (matches iOS SearchViewModel).
      // SSE 失败 → 回退到同步搜索 (与 iOS SearchViewModel 一致).
      try {
        const sync = await api.search(trimmed);
        if (controller.signal.aborted) return;
        dispatch({ type: "success", results: sync.results });
      } catch (syncError) {
        if (controller.signal.aborted) return;
        const message = syncError instanceof Error ? syncError.message : t("error.generic");
        dispatch({ type: "error", message });
      }
    }
  }, [api, serverURL, t]);

  useEffect(() => {
    // Re-fire whenever the navigation param changes. native-stack reuses the SAME Search instance
    // when Home re-navigates to it (search button: initialQuery="", card tap: initialQuery=title),
    // so without this dep the input field + results stay frozen on whatever was searched first.
    // 每次 navigation 参数变化都重跑. native-stack 在 Home 重新 navigate 到 Search 时会复用同一实例
    // (搜索按钮传 initialQuery="", 卡片点击传 title), 没有这条依赖输入框和结果会卡在首次搜索那一刻.
    if (initialQuery.trim().length > 0) {
      dispatch({ type: "setQuery", value: initialQuery });
      void runSearch(initialQuery);
    } else {
      dispatch({ type: "reset", query: "" });
    }
    return () => { controllerRef.current?.abort(); };
    // runSearch is stable for the screen's lifetime (deps are api, serverURL, t); intentionally omitted.
    // runSearch 在该屏幕生命期内稳定 (deps 是 api, serverURL, t), 故意不放进依赖.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  const onClearHistory = useCallback(() => {
    clearSearchHistory(serverURL);
    dispatch({ type: "setHistory", items: [] });
  }, [serverURL]);

  const onSelectHistory = useCallback((q: string) => {
    dispatch({ type: "setQuery", value: q });
    void runSearch(q);
  }, [runSearch]);

  const onResultPress = useCallback((result: SearchResult) => {
    const first = result.sources[0];
    if (!first) return;
    const dest: PlayDestination = {
      title: result.title,
      sources: result.sources,
      sourceKey: first.source_key,
      videoId: first.video_id,
      coverHint: result.cover,
    };
    navigation.navigate("Detail", dest);
  }, [navigation]);

  const progressText = computeProgressText(state.progress, t);

  return (
    <View style={[styles.root, { backgroundColor: colors.bgPrimary }]}>
      <View style={[styles.searchBar, { backgroundColor: colors.bgSecondary }]}>
        <TextInput
          style={[styles.input, { color: colors.textPrimary }]}
          value={state.query}
          onChangeText={(v) => dispatch({ type: "setQuery", value: v })}
          onSubmitEditing={() => void runSearch(state.query)}
          placeholder={t("placeholder")}
          placeholderTextColor={colors.textSecondary}
          returnKeyType="search"
          accessibilityLabel={t("placeholder")}
        />
      </View>
      {state.status === "loading" && progressText ? (
        <View style={styles.progressRow} testID="searchProgress">
          <ActivityIndicator color={colors.accent} />
          <Text style={[styles.progressText, { color: colors.textSecondary }]}>{progressText}</Text>
        </View>
      ) : null}
      {state.status === "success" && state.results.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ color: colors.textSecondary }}>{t("empty.noResults")}</Text>
        </View>
      ) : null}
      {state.status === "error" ? (
        <View style={[styles.center, { padding: 24 }]}>
          <Text style={{ color: colors.textPrimary }}>{t("error.generic")}</Text>
          <Text style={{ color: colors.textSecondary, marginTop: 6 }}>{state.errorMessage}</Text>
          <Pressable
            onPress={() => void runSearch(state.submitted)}
            style={[styles.retryBtn, { backgroundColor: colors.accent }]}
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>{t("error.retry")}</Text>
          </Pressable>
        </View>
      ) : null}
      <FlatList
        data={state.results}
        keyExtractor={(item, index) => resultKey(item, index)}
        contentContainerStyle={styles.resultsContent}
        {...LIST_PERF_DEFAULT}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onResultPress(item)}
            accessibilityRole="button"
            style={[
              styles.row,
              { backgroundColor: colors.bgCard, paddingHorizontal: isTablet ? 24 : 16 },
            ]}
          >
            <View style={styles.cover}>
              <PosterImage baseURL={serverURL} cover={item.cover} style={styles.coverImg} />
            </View>
            <View style={[styles.body, { paddingLeft: isTablet ? 16 : 12 }]}>
              <Text style={[styles.titleText, { color: colors.textPrimary }]} numberOfLines={1}>{item.title}</Text>
              {item.year || item.type ? (
                <Text style={[styles.metaText, { color: colors.textSecondary }]} numberOfLines={1}>
                  {[item.type, item.year].filter(Boolean).join(" · ")}
                </Text>
              ) : null}
              {item.desc ? (
                <Text style={[styles.descText, { color: colors.textSecondary }]} numberOfLines={2}>{item.desc}</Text>
              ) : null}
            </View>
          </Pressable>
        )}
        ListFooterComponent={
          <SearchHistoryFlow history={state.history} onSelect={onSelectHistory} onClear={onClearHistory} />
        }
      />
    </View>
  );
}

/**
 * Synthesise a FlatList key from the first source. Backend SearchResult has no top-level id;
 * `source_key:video_id` is unique per (title × source) pair. Falls back to `t:<title>:<index>`
 * when sources is empty (defensive — server always returns ≥1 source, but index disambiguates
 * if two source-less rows ever shared a title).
 * 后端 SearchResult 无顶层 id, 此处用首个源的 source_key:video_id 合成唯一 key;
 * sources 为空时退化到 t:<title>:<index> (服务端总会返回至少一个源, 索引仅作防御性消歧).
 */
function resultKey(item: SearchResult, index: number): string {
  const first = item.sources[0];
  if (first) return `${first.source_key}:${first.video_id}`;
  return `t:${item.title}:${index}`;
}

function computeProgressText(
  map: Partial<Record<"searching" | "probing", SearchProgress>>,
  t: (key: string, params?: Record<string, unknown>) => string,
): string {
  if (map.probing) return t("progress.probing", { completed: map.probing.completed, total: map.probing.total });
  if (map.searching) return t("progress.searching", { completed: map.searching.completed, total: map.searching.total });
  return t("progress.starting");
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  searchBar: { marginHorizontal: 16, marginVertical: 12, paddingHorizontal: 12, borderRadius: sizes.radius.md },
  input: { paddingVertical: 10, fontSize: 15 },
  progressRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 8 },
  progressText: { marginLeft: 8, fontSize: 12 },
  resultsContent: { paddingHorizontal: 16, paddingBottom: 24 },
  row: { flexDirection: "row", padding: 8, borderRadius: sizes.radius.md, marginBottom: 10 },
  cover: { width: 80, height: 120, borderRadius: sizes.radius.sm, overflow: "hidden", marginRight: 12 },
  coverImg: { width: "100%", height: "100%" },
  body: { flex: 1 },
  titleText: { fontSize: 17, fontWeight: "600" },
  metaText: { fontSize: 12, marginTop: 4 },
  descText: { fontSize: 12, marginTop: 4 },
  retryBtn: { marginTop: 16, paddingHorizontal: 18, paddingVertical: 10, borderRadius: sizes.radius.md },
  retryText: { color: "white", fontSize: 15 },
});
