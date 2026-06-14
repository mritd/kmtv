// SearchScreen — input + SSE-driven streaming search + sync fallback + server-scoped history chips.
// SearchScreen — 输入框 + SSE 流式搜索 + 同步回退 + 按服务器隔离的历史胶囊.

import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { createAPIClient } from "@/api/client";
import { createSearchAPI, type SearchAPI } from "@/api/search";
import type { PlayDestination, SearchProgress, SearchResult } from "@/api/types";
import { useLayoutWidth } from "@/designSystem/breakpoints";
import { LIST_PERF_DEFAULT } from "@/designSystem/listPerf";
import { PosterImage } from "@/designSystem/PosterImage";
import { Skeleton } from "@/designSystem/Skeleton";
import { sizes } from "@/designSystem/theme";
import { useTheme } from "@/designSystem/useTheme";
import type { HomeStackParamList, SearchResumeHint, SearchRouteParams } from "@/navigation/types";
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

function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

function selectSourceForResult(result: SearchResult, resumeHint?: SearchResumeHint): SearchResult["sources"][number] | undefined {
  if (!resumeHint) return result.sources[0];
  return result.sources.find((s) => s.source_key === resumeHint.sourceKey && s.video_id === resumeHint.videoId)
    ?? result.sources.find((s) => s.source_key === resumeHint.sourceKey)
    ?? result.sources[0];
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
  return (
    <Inner
      api={api}
      serverURL={serverURL}
      initialQuery={route?.params?.initialQuery ?? ""}
      resumeHint={route?.params?.resumeHint}
    />
  );
}

interface InnerProps {
  api: SearchAPI;
  serverURL: string;
  initialQuery: string;
  resumeHint?: SearchResumeHint;
}

function Inner({ api, serverURL, initialQuery, resumeHint }: InnerProps) {
  const { colors } = useTheme();
  const { t } = useTranslation("search");
  const layout = useLayoutWidth();
  const insets = useSafeAreaInsets();
  const isTablet = layout !== "phone";
  // HomeStackParamList and CategoriesStackParamList both define "Player" with PlayDestination,
  // so typing as HomeStackParamList here works whether SearchScreen is mounted under either tab.
  // HomeStackParamList 与 CategoriesStackParamList 的 Player 都指向 PlayDestination, 在此用 HomeStackParamList
  // 类型化即可同时覆盖两个 Tab 的导航类型.
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const canGoBack = typeof navigation.canGoBack === "function" ? navigation.canGoBack() : false;
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
  const resumeKey = resumeHint
    ? `${resumeHint.title}:${resumeHint.sourceKey}:${resumeHint.videoId}:${resumeHint.episodeIndex}:${resumeHint.episodeName}`
    : "";

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
    // Re-fire whenever the navigation search context changes. native-stack reuses the SAME Search
    // instance when Home re-navigates to it, so both initialQuery and continue-watching resumeHint
    // must participate in the key.
    // 每次 navigation 搜索上下文变化都重跑. native-stack 会复用同一 Search 实例, 因此 initialQuery
    // 和继续观看传入的 resumeHint 都必须参与 key.
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
  }, [initialQuery, resumeKey]);

  const onClearHistory = useCallback(() => {
    clearSearchHistory(serverURL);
    dispatch({ type: "setHistory", items: [] });
  }, [serverURL]);

  const clearQuery = useCallback(() => {
    controllerRef.current?.abort();
    dispatch({ type: "reset", query: "" });
  }, []);

  const onSelectHistory = useCallback((q: string) => {
    dispatch({ type: "setQuery", value: q });
    void runSearch(q);
  }, [runSearch]);

  const submitCurrentQuery = useCallback(() => {
    void runSearch(state.query);
  }, [runSearch, state.query]);

  const onResultPress = useCallback((result: SearchResult) => {
    const matchingResume = resumeHint && normalizeTitle(result.title) === normalizeTitle(resumeHint.title)
      ? resumeHint
      : undefined;
    const first = selectSourceForResult(result, matchingResume);
    if (!first) return;
    const dest: PlayDestination = {
      title: result.title,
      sources: result.sources,
      sourceKey: first.source_key,
      videoId: first.video_id,
      coverHint: result.cover,
      resumeIntent: matchingResume
        ? { episodeIndex: matchingResume.episodeIndex, episodeName: matchingResume.episodeName }
        : undefined,
    };
    navigation.navigate("Player", dest);
  }, [navigation, resumeHint]);

  const progressText = computeProgressText(state.progress, t);
  const canSubmit = state.query.trim().length > 0 && state.status !== "loading";
  const showHistory = state.status === "idle";
  const showResults = state.status === "success" && state.results.length > 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.bgPrimary, paddingTop: insets.top }]}>
      <View style={styles.searchHeader}>
        {canGoBack ? (
          <Pressable
            testID="searchBackButton"
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.65 : 1 }]}
          >
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </Pressable>
        ) : null}
        <View style={[styles.searchBar, { backgroundColor: colors.bgSecondary }]}>
          <Ionicons name="search" size={18} color={colors.textSecondary} style={styles.leadingIcon} />
          <TextInput
            style={[styles.input, { color: colors.textPrimary }]}
            value={state.query}
            onChangeText={(v) => dispatch({ type: "setQuery", value: v })}
            onSubmitEditing={submitCurrentQuery}
            placeholder={t("placeholder")}
            placeholderTextColor={colors.textSecondary}
            returnKeyType="search"
            accessibilityLabel={t("placeholder")}
          />
          {state.query.length > 0 ? (
            <Pressable
              testID="searchClearButton"
              accessibilityRole="button"
              accessibilityLabel={t("history.clear")}
              onPress={clearQuery}
              style={({ pressed }) => [styles.clearButton, { opacity: pressed ? 0.65 : 1 }]}
            >
              <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            </Pressable>
          ) : null}
          <Pressable
            testID="searchSubmitButton"
            accessibilityRole="button"
            accessibilityLabel={t("title")}
            disabled={!canSubmit}
            onPress={submitCurrentQuery}
            style={({ pressed }) => [
              styles.submitButton,
              { opacity: !canSubmit ? 0.35 : pressed ? 0.65 : 1 },
            ]}
          >
            <Ionicons name="arrow-forward-circle" size={22} color={colors.textPrimary} />
          </Pressable>
        </View>
      </View>
      {state.status === "loading" ? (
        <SearchLoadingState progressText={progressText} accent={colors.accent} textColor={colors.textSecondary} />
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
      {showHistory ? (
        <SearchHistoryFlow history={state.history} onSelect={onSelectHistory} onClear={onClearHistory} />
      ) : null}
      {showResults ? (
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
        />
      ) : null}
    </View>
  );
}

function SearchLoadingState(
  { progressText, accent, textColor }: { progressText: string; accent: string; textColor: string },
) {
  return (
    <View style={styles.loadingContainer}>
      <View style={styles.progressRow} testID="searchProgress">
        <ActivityIndicator color={accent} />
        <Text style={[styles.progressText, { color: textColor }]}>{progressText}</Text>
      </View>
      {Array.from({ length: 5 }).map((_, index) => (
        <View key={index} style={styles.skeletonRow}>
          <Skeleton width={80} height={120} radius={sizes.radius.sm} testID="searchSkeletonCover" />
          <View style={styles.skeletonBody}>
            <Skeleton width={180} height={18} />
            <Skeleton width={96} height={12} />
            <Skeleton width={220} height={12} />
          </View>
        </View>
      ))}
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
  searchHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  searchBar: {
    flex: 1,
    paddingLeft: 12,
    paddingRight: 6,
    borderRadius: sizes.radius.md,
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, paddingVertical: 10, fontSize: 15 },
  leadingIcon: { marginRight: 8 },
  clearButton: { width: 32, height: 40, alignItems: "center", justifyContent: "center" },
  submitButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  progressRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 8 },
  progressText: { marginLeft: 8, fontSize: 12 },
  loadingContainer: { paddingHorizontal: 16, paddingBottom: 24 },
  skeletonRow: { flexDirection: "row", paddingVertical: 8, marginBottom: 10 },
  skeletonBody: { justifyContent: "center", gap: 10, marginLeft: 12 },
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
