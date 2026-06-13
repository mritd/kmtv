// SourceSwitcher — grid of source pills with Show-all/Collapse toggle for long lists.
// SourceSwitcher — 源胶囊网格, 列表过长时折叠并暴露 "全部展开 / 收起" 切换.

import React, { useState } from "react";
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
            <SourceButton source={s} isSelected={s.source_key === currentKey} onPress={onSelect} />
          </View>
        ))}
      </View>
      {sources.length > COLLAPSE_THRESHOLD ? (
        <Pressable accessibilityRole="button" onPress={() => setShowAll((v) => !v)} style={styles.toggleRow}>
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
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
  toggleRow: { paddingVertical: 6, alignItems: "center" },
});
