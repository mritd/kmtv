// English. 中文.
// Placeholder Home screen for M1. Real implementation lands in M2.
// M1 阶段的 Home 占位屏, 真实实现见 M2.

import { Text, View } from "react-native";

import { useTheme } from "@/designSystem/useTheme";

/**
 * Placeholder screen displaying the tab name centred on the theme background.
 * 在主题背景中央显示 Tab 名称的占位屏.
 */
export function HomeScreen() {
  const { colors } = useTheme();
  return (
    <View
      testID="homePlaceholder"
      style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bgPrimary }}
    >
      <Text style={{ color: colors.textPrimary }}>Home</Text>
    </View>
  );
}
