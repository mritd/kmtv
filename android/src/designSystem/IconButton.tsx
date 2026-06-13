// IconButton — pressable circular icon for inline actions (favorite star, edit pencil, etc).
// IconButton — 用于内嵌操作 (收藏星、编辑铅笔等) 的圆形可点击图标按钮.

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet } from "react-native";

import { useTheme } from "./useTheme";

/**
 * Props for IconButton — wraps an Ionicons glyph in a pressable hit target.
 * IconButton 的 props — 把一个 Ionicons 字形包裹到可点击区域内.
 */
export interface IconButtonProps {
  name: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
  size?: number;
  active?: boolean;
  color?: string;
  disabled?: boolean;
}

/**
 * IconButton — circular pressable wrapping an Ionicons glyph.
 * IconButton — 圆形可点击区域包裹的 Ionicons 字形.
 */
export function IconButton({
  name, onPress, accessibilityLabel, testID, size = 22, active, color, disabled,
}: IconButtonProps) {
  const { colors } = useTheme();
  const tint = color ?? (active ? colors.accent : colors.textSecondary);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [styles.hit, pressed ? styles.pressed : null]}
    >
      <Ionicons name={name} size={size} color={tint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: { padding: 6, borderRadius: 999 },
  pressed: { opacity: 0.6 },
});
