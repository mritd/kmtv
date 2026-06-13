// LanguageSection — pill radio for EN / ZH. Persists via i18nStore and live-switches i18next.
// LanguageSection — EN / ZH 二选一的 pill 单选, 通过 i18nStore 持久化并实时切换 i18next.

import i18next from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { sizes } from "@/designSystem/theme";
import { useTheme } from "@/designSystem/useTheme";
import type { Lang } from "@/i18n";
import { useI18nStore } from "@/store/i18nStore";

/**
 * LanguageSection — EN / ZH pill radio.
 * LanguageSection — EN / ZH 二选一的 pill 单选.
 */
export function LanguageSection() {
  const { colors } = useTheme();
  const { t } = useTranslation("profile");
  const lang = useI18nStore((s) => s.lang);
  const setLang = useI18nStore((s) => s.setLang);

  const choose = async (next: Lang) => {
    setLang(next);
    await i18next.changeLanguage(next);
  };

  return (
    <View style={styles.section}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{t("language.title")}</Text>
      <View style={styles.row}>
        {(["en", "zh"] as Lang[]).map((opt) => {
          const active = opt === lang;
          return (
            <Pressable
              key={opt}
              testID={`lang-${opt}`}
              onPress={() => void choose(opt)}
              style={[styles.pill, { backgroundColor: active ? colors.accent : colors.bgCard }]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={{ color: active ? "white" : colors.textPrimary, fontSize: 13 }}>
                {t(`language.options.${opt}`)}
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
