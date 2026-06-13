// Search history chip flow + Clear button. Wrap layout via flexDirection:row + flexWrap:wrap.
// 搜索历史胶囊流式布局 + 清空按钮. 通过 flexDirection:row + flexWrap:wrap 实现自动换行.

import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { sizes } from "@/designSystem/theme";
import { useTheme } from "@/designSystem/useTheme";
import type { SearchHistoryItem } from "@/storage/searchHistory";

/**
 * Props for the search history block.
 * 搜索历史区块的 props.
 */
export interface SearchHistoryFlowProps {
  history: SearchHistoryItem[];
  onSelect: (query: string) => void;
  onClear: () => void;
}

/**
 * SearchHistoryFlow renders the recent-queries chip block. Hidden when history is empty.
 * SearchHistoryFlow 渲染最近搜索胶囊区块. 历史为空时不渲染.
 */
export function SearchHistoryFlow({ history, onSelect, onClear }: SearchHistoryFlowProps) {
  const { colors } = useTheme();
  const { t } = useTranslation("search");
  if (history.length === 0) return null;
  return (
    <View testID="searchHistoryFlow" style={styles.section}>
      <View style={styles.header}>
        <Text style={[styles.heading, { color: colors.textPrimary }]}>
          {t("history.heading")}
        </Text>
        <Pressable onPress={onClear} accessibilityRole="button">
          <Text style={[styles.clear, { color: colors.textSecondary }]}>{t("history.clear")}</Text>
        </Pressable>
      </View>
      <View style={styles.flow}>
        {history.map((item) => (
          <Pressable
            key={item.query}
            accessibilityRole="button"
            onPress={() => onSelect(item.query)}
            style={[styles.chip, { backgroundColor: colors.bgSecondary }]}
          >
            <Text style={[styles.chipText, { color: colors.textPrimary }]} numberOfLines={1}>
              {item.query}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, paddingVertical: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  heading: { fontSize: 17, fontWeight: "600" },
  clear: { fontSize: 12 },
  flow: { flexDirection: "row", flexWrap: "wrap" },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: sizes.radius.xl,
    marginRight: 8,
    marginBottom: 8,
  },
  chipText: { fontSize: 12 },
});
