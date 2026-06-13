// FavoriteRow — cover + title + type/year row used inside the Favorites list.
// FavoriteRow — 用于 Favorites 列表的封面 + 标题 + 类型/年份单行视图.

import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { PosterImage } from "@/designSystem/PosterImage";
import { sizes } from "@/designSystem/theme";
import { useTheme } from "@/designSystem/useTheme";
import type { FavoriteItem } from "@/storage/favorites";

/**
 * Props for FavoriteRow — server-baseURL for cover URL composition and the tap target.
 * FavoriteRow 的 props — 提供拼接封面 URL 的 serverURL 与点击回调.
 */
export interface FavoriteRowProps {
  item: FavoriteItem;
  serverURL: string;
  onPress: (item: FavoriteItem) => void;
  testID?: string;
}

/**
 * Single Favorites row — cover 50x75, title, type/year subtitle.
 * 单行收藏视图 — 50x75 封面 + 标题 + 类型/年份副标题.
 */
export function FavoriteRow({ item, serverURL, onPress, testID }: FavoriteRowProps) {
  const { colors } = useTheme();
  const { t } = useTranslation("favorites");
  return (
    <Pressable testID={testID} onPress={() => onPress(item)} style={[styles.row, { backgroundColor: colors.bgCard }]}>
      <PosterImage baseURL={serverURL} cover={item.cover} style={styles.cover} />
      <View style={styles.text}>
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>{item.title}</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {t("meta.typeYear", { type: item.type, year: item.year })}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, gap: 12 },
  cover: { width: 50, height: 75, borderRadius: sizes.radius.sm },
  text: { flex: 1 },
  title: { fontSize: 15 },
  subtitle: { fontSize: 12, marginTop: 4 },
});
