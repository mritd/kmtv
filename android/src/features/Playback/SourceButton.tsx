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
}

/**
 * SourceButton — renders the source name; selected version uses accent background.
 * SourceButton — 渲染源名称, 选中时使用 accent 背景.
 */
export function SourceButton({ source, isSelected, onPress }: SourceButtonProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => onPress(source.source_key)}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      style={[
        styles.root,
        { backgroundColor: isSelected ? colors.accent : colors.bgCard },
      ]}
    >
      <Text
        numberOfLines={1}
        style={{ color: isSelected ? "white" : colors.textPrimary, fontSize: 12, fontWeight: "600" }}
      >
        {source.source_name}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: sizes.radius.sm, alignItems: "center" },
});
