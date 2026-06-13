// CategoryChip — shared sub / region / tab chip with active styling. RN replacement for web's button chips.
// CategoryChip — 共享的 子分类 / 地区 / 顶层 tab 胶囊, 含选中态. 对应 web 的 button chip.

import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { sizes } from "@/designSystem/theme";
import { useTheme } from "@/designSystem/useTheme";

/**
 * Props for the shared chip primitive.
 * 共享胶囊组件 props.
 */
export interface CategoryChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
}

/**
 * CategoryChip renders one tappable filter chip with theme-aware active styling.
 * CategoryChip 渲染一个可点击的筛选胶囊, 选中态遵循当前主题.
 */
export function CategoryChip({ label, active, onPress, testID }: CategoryChipProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      testID={testID}
      style={[
        styles.base,
        {
          backgroundColor: active ? colors.accent : colors.bgSecondary,
          borderColor: active ? colors.accent : "transparent",
        },
      ]}
    >
      <Text
        numberOfLines={1}
        style={[styles.label, { color: active ? "white" : colors.textPrimary }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: sizes.radius.xl,
    borderWidth: 1,
    marginRight: 8,
    marginBottom: 8,
  },
  label: { fontSize: 12 },
});
