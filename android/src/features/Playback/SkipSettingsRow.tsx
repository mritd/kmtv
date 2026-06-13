// SkipSettingsRow — two pill chips that adjust skip intro / skip outro seconds in 5-second steps.
// SkipSettingsRow — 两个胶囊, 每点一次以 5 秒为步长调整跳过片头/片尾.

import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { sizes } from "@/designSystem/theme";
import { useTheme } from "@/designSystem/useTheme";

const STEP_SECONDS = 5;

/**
 * Props for the skip-settings row.
 * 跳过片头/片尾设置行的 props.
 */
export interface SkipSettingsRowProps {
  skipIntroSeconds: number;
  skipOutroSeconds: number;
  onChangeIntro: (seconds: number) => void;
  onChangeOutro: (seconds: number) => void;
}

/**
 * SkipSettingsRow — pills for skip-intro / skip-outro with ± step controls.
 * SkipSettingsRow — 跳过片头 / 跳过片尾的两个胶囊, 配带 ± 步进按钮.
 */
export function SkipSettingsRow({ skipIntroSeconds, skipOutroSeconds, onChangeIntro, onChangeOutro }: SkipSettingsRowProps) {
  const { t } = useTranslation("playback");
  return (
    <View style={styles.row}>
      <Chip
        label={t("skipIntro")}
        seconds={skipIntroSeconds}
        onChange={(v) => onChangeIntro(Math.max(0, v))}
      />
      <View style={{ width: 12 }} />
      <Chip
        label={t("skipOutro")}
        seconds={skipOutroSeconds}
        onChange={(v) => onChangeOutro(Math.max(0, v))}
      />
    </View>
  );
}

interface ChipProps { label: string; seconds: number; onChange: (next: number) => void }

function Chip({ label, seconds, onChange }: ChipProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.chip, { backgroundColor: colors.bgCard }]}>
      <Text style={{ color: colors.textSecondary, fontSize: 11, paddingHorizontal: 8 }}>{label}</Text>
      <Text style={{ color: colors.textSecondary, fontSize: 11, width: 36, textAlign: "right" }}>{seconds}s</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="decrement" onPress={() => onChange(seconds - STEP_SECONDS)} style={styles.btn}>
        <Text style={{ color: seconds > 0 ? colors.textPrimary : colors.textSecondary, fontSize: 13, fontWeight: "600" }}>-</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="increment" onPress={() => onChange(seconds + STEP_SECONDS)} style={styles.btn}>
        <Text style={{ color: colors.textPrimary, fontSize: 13, fontWeight: "600" }}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  chip: { flexDirection: "row", alignItems: "center", borderRadius: sizes.radius.sm, paddingVertical: 4, paddingRight: 4 },
  btn: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
});
