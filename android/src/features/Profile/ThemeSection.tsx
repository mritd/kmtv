// ThemeSection — pill radio for system / light / dark. Persists via themeStore.
// ThemeSection — system / light / dark 三选一的 pill 单选, 通过 themeStore 持久化.

import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ThemeOverride } from "@/designSystem/ThemeProvider";
import { sizes } from "@/designSystem/theme";
import { useTheme } from "@/designSystem/useTheme";
import { useThemeStore } from "@/store/themeStore";

const OPTIONS: ThemeOverride[] = ["system", "light", "dark"];

/**
 * ThemeSection — system / light / dark pill radio.
 * ThemeSection — system / light / dark 三选一的 pill 单选.
 */
export function ThemeSection() {
  const { colors } = useTheme();
  const { t } = useTranslation("profile");
  const override = useThemeStore((s) => s.override);
  const setOverride = useThemeStore((s) => s.setOverride);
  return (
    <View style={styles.section}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{t("theme.title")}</Text>
      <View style={styles.row}>
        {OPTIONS.map((opt) => {
          const active = opt === override;
          return (
            <Pressable
              key={opt}
              testID={`theme-${opt}`}
              onPress={() => setOverride(opt)}
              style={[styles.pill, { backgroundColor: active ? colors.accent : colors.bgCard }]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={{ color: active ? "white" : colors.textPrimary, fontSize: 13 }}>
                {t(`theme.options.${opt}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  title: { fontSize: 13, fontWeight: "700" },
  row: { flexDirection: "row", gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: sizes.radius.md },
});
