// FavoritesScreen — list of favorites with swipe-to-delete. Replaces the M1 placeholder.
//
// FavoritesScreen — 带左滑删除的收藏列表, 替换 M1 占位.

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";

import type { PlayDestination } from "@/api/types";
import { LIST_PERF_DEFAULT } from "@/designSystem/listPerf";
import { useTheme } from "@/designSystem/useTheme";
import type { SearchRouteParams } from "@/navigation/types";
import { useServerStore } from "@/store/serverStore";
import { useSync, useSyncList } from "@/sync/SyncContext";
import type { LocalRecord } from "@/sync/types";

import { FavoriteRow } from "./FavoriteRow";

/**
 * Props injected by FavoritesStack. `navigation.navigate` lands on Player or Search.
 *
 * 由 FavoritesStack 注入的 props. navigation.navigate 跳转到 Player 或 Search.
 */
export interface FavoritesScreenProps {
  navigation: {
    navigate: ((route: "Player", params: PlayDestination) => void) & ((route: "Search", params: SearchRouteParams) => void);
  };
}

/**
 * FavoritesScreen — root of the FavoritesTab. The list comes from the sync store and refreshes on focus.
 *
 * FavoritesScreen — FavoritesTab 的根. 列表来自同步存储, 并在获得焦点时刷新.
 */
export function FavoritesScreen({ navigation }: FavoritesScreenProps) {
  const { colors } = useTheme();
  const { t } = useTranslation("favorites");
  const serverURL = useServerStore((s) => s.serverURL) ?? "";
  const sync = useSync();
  const items = useSyncList("favorite");
  const engine = sync.status === "ready" ? sync.engine : null;

  useFocusEffect(
    useCallback(() => {
      void engine?.requestSync("page");
    }, [engine]),
  );

  // A favorite saved on another device may have no source; search by title to find fresh ones.
  //
  // 其他设备保存的收藏可能没有来源; 按标题搜索以获取最新来源.
  const onOpenDetail = useCallback((it: LocalRecord<"favorite">) => {
    const p = it.payload;
    if (!p.source_key || !p.video_id) {
      navigation.navigate("Search", { initialQuery: p.title });
      return;
    }
    navigation.navigate("Player", { title: p.title, sources: [], sourceKey: p.source_key, videoId: p.video_id, coverHint: p.cover });
  }, [navigation]);

  const onDelete = useCallback((it: LocalRecord<"favorite">) => {
    if (sync.status === "ready") sync.store.remove("favorite", it.key);
  }, [sync]);

  if (items.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bgPrimary }]}>
        <Ionicons name="star" size={48} color={colors.textSecondary} />
        <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>{t("empty.title")}</Text>
        <Text style={[styles.emptyDesc, { color: colors.textSecondary }]}>{t("empty.description")}</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: colors.bgPrimary }}
      data={items}
      keyExtractor={(it) => it.key}
      {...LIST_PERF_DEFAULT}
      renderItem={({ item }) => (
        <Swipeable
          renderRightActions={() => (
            <Pressable
              testID={`favorite-delete-${item.key}`}
              onPress={() => onDelete(item)}
              style={styles.delete}
              accessibilityRole="button"
              accessibilityLabel={t("actions.remove")}
            >
              <Text style={styles.deleteLabel}>{t("actions.remove")}</Text>
            </Pressable>
          )}
        >
          <FavoriteRow
            testID={`favorite-row-${item.key}`}
            item={item}
            serverURL={serverURL}
            onPress={onOpenDetail}
          />
        </Swipeable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 17, fontWeight: "700" },
  emptyDesc: { fontSize: 13, textAlign: "center" },
  delete: { width: 88, alignItems: "center", justifyContent: "center", backgroundColor: "#d33" },
  deleteLabel: { color: "white", fontSize: 14, fontWeight: "700" },
});
