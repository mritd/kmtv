// FavoritesScreen — list of favorites with swipe-to-delete. Replaces the M1 placeholder.
// FavoritesScreen — 带左滑删除的收藏列表, 替换 M1 占位.

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";

import type { PlayDestination } from "@/api/types";
import { LIST_PERF_DEFAULT } from "@/designSystem/listPerf";
import { useTheme } from "@/designSystem/useTheme";
import { listFavorites, removeFavorite, type FavoriteItem } from "@/storage/favorites";
import { useServerStore } from "@/store/serverStore";

import { FavoriteRow } from "./FavoriteRow";

/**
 * Props injected by FavoritesStack. `navigation.navigate` lands on Player.
 * 由 FavoritesStack 注入的 props. navigation.navigate 跳转到 Player.
 */
export interface FavoritesScreenProps {
  navigation: { navigate: (route: "Player", params: PlayDestination) => void };
}

/**
 * FavoritesScreen — root of the FavoritesTab. Hydrates from MMKV every time the tab is focused.
 * FavoritesScreen — FavoritesTab 的根. 每次 tab 被聚焦时从 MMKV 重新读取.
 */
export function FavoritesScreen({ navigation }: FavoritesScreenProps) {
  const { colors } = useTheme();
  const { t } = useTranslation("favorites");
  const serverURL = useServerStore((s) => s.serverURL) ?? "";
  const [items, setItems] = useState<FavoriteItem[]>([]);

  const reload = useCallback(() => {
    setItems(listFavorites(serverURL));
  }, [serverURL]);

  useFocusEffect(reload);

  const onOpenDetail = useCallback((it: FavoriteItem) => {
    const destination: PlayDestination = {
      title: it.title,
      sources: [],
      sourceKey: it.sourceKey,
      videoId: it.videoId,
      coverHint: it.cover,
    };
    navigation.navigate("Player", destination);
  }, [navigation]);

  const onDelete = useCallback((it: FavoriteItem) => {
    removeFavorite(serverURL, it.sourceKey, it.videoId);
    reload();
  }, [reload, serverURL]);

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
      keyExtractor={(it) => `${it.sourceKey}:${it.videoId}`}
      {...LIST_PERF_DEFAULT}
      renderItem={({ item }) => (
        <Swipeable
          renderRightActions={() => (
            <Pressable
              testID={`favorite-delete-${item.sourceKey}:${item.videoId}`}
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
            testID={`favorite-row-${item.sourceKey}:${item.videoId}`}
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
