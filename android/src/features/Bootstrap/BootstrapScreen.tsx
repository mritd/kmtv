// BootstrapScreen renders a centred spinner and kicks off authStore.bootstrap.
// BootstrapScreen 居中显示加载指示并触发 authStore.bootstrap.

import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";

import { useTheme } from "@/designSystem/useTheme";
import { useAuthStore } from "@/store/authStore";

/**
 * Entry screen shown while authStore resolves its initial state.
 * authStore 解析初始状态期间显示的入口屏.
 */
export function BootstrapScreen() {
  const { colors } = useTheme();
  const bootstrap = useAuthStore((s) => s.bootstrap);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);
  return (
    <View
      testID="bootstrapScreen"
      style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bgPrimary }}
    >
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}
