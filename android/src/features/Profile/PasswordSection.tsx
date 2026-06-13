// PasswordSection — current/next/confirm SecureField triplet + Save button.
// PasswordSection — 当前/新/确认 三个 SecureField + 保存按钮.

import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { sizes } from "@/designSystem/theme";
import { useTheme } from "@/designSystem/useTheme";

import type { UseProfileResult } from "./useProfile";

/**
 * Props for PasswordSection — receives the `useProfile` result so it can read+write fields.
 * PasswordSection 的 props — 接收 useProfile 结果以读写各字段.
 */
export interface PasswordSectionProps {
  profile: UseProfileResult;
}

/**
 * PasswordSection — collapsed by default; expands to three SecureFields + Save on header tap.
 * PasswordSection — 默认折叠; 点击标题展开三个 SecureField 与保存按钮.
 */
export function PasswordSection({ profile }: PasswordSectionProps) {
  const { colors } = useTheme();
  const { t } = useTranslation("profile");
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.section}>
      <Pressable testID="passwordToggle" onPress={() => setOpen((p) => !p)} accessibilityRole="button">
        <Text style={[styles.title, { color: colors.textPrimary }]}>{t("password.title")}</Text>
      </Pressable>
      {open ? (
        <View style={{ gap: 8, marginTop: 8 }}>
          <TextInput
            testID="passwordCurrent"
            placeholder={t("password.current")}
            secureTextEntry
            value={profile.passwordCurrent}
            onChangeText={profile.setPasswordCurrent}
            style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.bgCard }]}
            placeholderTextColor={colors.textSecondary}
          />
          <TextInput
            testID="passwordNext"
            placeholder={t("password.next")}
            secureTextEntry
            value={profile.passwordNext}
            onChangeText={profile.setPasswordNext}
            style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.bgCard }]}
            placeholderTextColor={colors.textSecondary}
          />
          <TextInput
            testID="passwordConfirm"
            placeholder={t("password.confirm")}
            secureTextEntry
            value={profile.passwordConfirm}
            onChangeText={profile.setPasswordConfirm}
            style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.bgCard }]}
            placeholderTextColor={colors.textSecondary}
          />
          <Pressable
            testID="passwordSave"
            onPress={() => void profile.submitPassword()}
            style={[styles.save, { backgroundColor: colors.accent }]}
            accessibilityRole="button"
          >
            <Text style={{ color: "white", fontSize: 14, fontWeight: "700" }}>{t("password.save")}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 15, fontWeight: "700" },
  input: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: sizes.radius.md, fontSize: 14 },
  save: { alignItems: "center", paddingVertical: 12, borderRadius: sizes.radius.md, marginTop: 4 },
});
