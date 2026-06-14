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
  variant?: "filled" | "outline";
}

/**
 * CategoryChip renders one tappable filter chip with theme-aware active styling.
 * CategoryChip 渲染一个可点击的筛选胶囊, 选中态遵循当前主题.
 */
export function CategoryChip({ label, active, onPress, testID, variant = "filled" }: CategoryChipProps) {
  const { colors } = useTheme();
  const isOutline = variant === "outline";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      testID={testID}
      style={[
        styles.base,
        styles[isOutline ? "outlineBase" : "filledBase"],
        {
          backgroundColor: isOutline ? "transparent" : active ? colors.accent : colors.bgCard,
          borderColor: isOutline ? (active ? colors.accent : colors.textSecondary) : "transparent",
          opacity: isOutline && !active ? 0.72 : 1,
        },
      ]}
    >
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={[
          styles.label,
          styles[isOutline ? "outlineLabel" : "filledLabel"],
          { color: active ? (isOutline ? colors.accent : "white") : (isOutline ? colors.textSecondary : colors.textPrimary) },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: sizes.radius.xl,
    borderWidth: 1,
    marginRight: 8,
    marginBottom: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  filledBase: { height: 32, paddingHorizontal: 14 },
  outlineBase: { height: 28, paddingHorizontal: 10 },
  label: { fontSize: 12, lineHeight: 16, includeFontPadding: false },
  filledLabel: { fontWeight: "400" },
  outlineLabel: { fontSize: 11, lineHeight: 14 },
});
