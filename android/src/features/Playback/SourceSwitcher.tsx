// SourceSwitcher — grid of source pills with Show-all/Collapse toggle for long lists.
// SourceSwitcher — 源胶囊网格, 列表过长时折叠并暴露 "全部展开 / 收起" 切换.

import React, { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { SourceResult } from "@/api/types";
import { useTheme } from "@/designSystem/useTheme";

import { SourceButton } from "./SourceButton";

const COLLAPSE_THRESHOLD = 6;

/**
 * Props — full source list, current selected key, and click handler.
 * Props — 完整源列表、当前选中 key 与点击回调.
 */
export interface SourceSwitcherProps {
  sources: SourceResult[];
  currentKey: string;
  onSelect: (sourceKey: string) => void;
}

/**
 * SourceSwitcher — renders a wrap grid; > 6 items collapses to 6 by default.
 * SourceSwitcher — 渲染换行网格, 超过 6 项默认折叠.
 */
export function SourceSwitcher({ sources, currentKey, onSelect }: SourceSwitcherProps) {
  const { colors } = useTheme();
  const { t } = useTranslation("playback");
  const [showAll, setShowAll] = useState(false);

  const display = showAll || sources.length <= COLLAPSE_THRESHOLD
    ? sources
    : sources.slice(0, COLLAPSE_THRESHOLD);

  return (
    <View>
      <View style={styles.grid}>
        {display.map((s) => (
          <View key={s.source_key} style={styles.cell}>
            <SourceButton compact source={s} isSelected={s.source_key === currentKey} onPress={onSelect} />
          </View>
        ))}
      </View>
      {sources.length > COLLAPSE_THRESHOLD ? (
        <Pressable
          testID="sourceToggleButton"
          accessibilityRole="button"
          onPress={() => setShowAll((v) => !v)}
          style={({ pressed }) => [
            styles.toggleRow,
            {
              backgroundColor: colors.bgCard,
              borderColor: colors.bgSecondary,
              opacity: pressed ? 0.72 : 1,
            },
          ]}
        >
          <Ionicons name={showAll ? "chevron-up" : "chevron-down"} size={14} color={colors.accent} />
          <Text style={{ color: colors.accent, fontSize: 12, fontWeight: "700" }}>
            {showAll ? t("collapse") : t("showAll", { count: sources.length })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "33.333%", padding: 4 },
  toggleRow: {
    marginHorizontal: 4,
    marginTop: 8,
    minHeight: 36,
    borderWidth: 1,
    borderRadius: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
});
