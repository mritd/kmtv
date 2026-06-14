// SourceButton — pill button for a single source pick inside SourceSwitcher.
// SourceButton — SourceSwitcher 中的单源选择胶囊按钮.

import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import type { SourceResult } from "@/api/types";
import { sizes } from "@/designSystem/theme";
import { useTheme } from "@/designSystem/useTheme";

/**
 * Single-source pill — selection state drives accent fill, accessibilityState mirrors it.
 * 单源胶囊按钮, 选中态填 accent, accessibilityState 保持一致.
 */
export interface SourceButtonProps {
  source: SourceResult;
  isSelected: boolean;
  onPress: (sourceKey: string) => void;
  compact?: boolean;
}

/**
 * SourceButton — renders the source name; selected version uses accent background.
 * SourceButton — 渲染源名称, 选中时使用 accent 背景.
 */
export function SourceButton({ source, isSelected, onPress, compact = false }: SourceButtonProps) {
  const { colors } = useTheme();
  const name = cleanSourceName(source.source_name);
  return (
    <Pressable
      testID={`sourceButton-${source.source_key}`}
      onPress={() => onPress(source.source_key)}
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ selected: isSelected }}
      style={[
        styles.root,
        compact ? styles.compact : styles.bordered,
        { backgroundColor: isSelected ? colors.accent : colors.bgCard },
      ]}
    >
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        style={{ color: isSelected ? "white" : colors.textPrimary, fontSize: 12, fontWeight: "600" }}
      >
        {name}
      </Text>
    </Pressable>
  );
}

function cleanSourceName(name: string): string {
  return name.replace(/^(🎬|🔞)\s?/u, "");
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: sizes.radius.sm, alignItems: "center" },
  bordered: { minWidth: 88, maxWidth: 140 },
  compact: { width: "100%" },
});
