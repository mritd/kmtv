// Placeholder Categories screen for M1. Real implementation lands in M3.
// M1 阶段的 Categories 占位屏, 真实实现见 M3.

import { Text, View } from "react-native";

import { useTheme } from "@/designSystem/useTheme";

/**
 * Placeholder screen displaying the tab name centred on the theme background.
 * 在主题背景中央显示 Tab 名称的占位屏.
 */
export function CategoriesScreen() {
  const { colors } = useTheme();
  return (
    <View
      testID="categoriesPlaceholder"
      style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bgPrimary }}
    >
      <Text style={{ color: colors.textPrimary }}>Categories</Text>
    </View>
  );
}
