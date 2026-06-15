// SourceButton — pill button for a single source pick inside SourceSwitcher.
// SourceButton — SourceSwitcher 中的单源选择胶囊按钮.

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { SourceResult } from "@/api/types";
import { sizes } from "@/designSystem/theme";
import { useTheme } from "@/designSystem/useTheme";

const LATENCY_GOOD = "#54d86a";
const LATENCY_WARN = "#f6c453";
const LATENCY_BAD = "#fb4667";

/**
 * Single-source pill — selection state drives accent fill, accessibilityState mirrors it.
 * 单源胶囊按钮, 选中态填 accent, accessibilityState 保持一致.
 */
export interface SourceButtonProps {
  source: SourceResult;
  isSelected: boolean;
  onPress: (sourceKey: string) => void;
  compact?: boolean;
}

/**
 * SourceButton — renders the source name; selected version uses accent background.
 * SourceButton — 渲染源名称, 选中时使用 accent 背景.
 */
export function SourceButton({ source, isSelected, onPress, compact = false }: SourceButtonProps) {
  const { colors } = useTheme();
  const name = cleanSourceName(source.source_name);
  const latency = formatLatency(source.duration_ms);
  const textColor = isSelected ? "white" : colors.textPrimary;
  const latencyColor = latencyColorForDuration(source.duration_ms) ?? (isSelected ? "rgba(255,255,255,0.78)" : colors.textSecondary);
  return (
    <Pressable
      testID={`sourceButton-${source.source_key}`}
      onPress={() => onPress(source.source_key)}
      accessibilityRole="button"
      accessibilityLabel={latency ? `${name} ${latency}` : name}
      accessibilityState={{ selected: isSelected }}
      style={[
        styles.root,
        compact ? styles.compact : styles.bordered,
        { backgroundColor: isSelected ? colors.accent : colors.bgCard },
      ]}
    >
      <View style={styles.textStack}>
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{ color: textColor, fontSize: 12, fontWeight: "700" }}
        >
          {name}
        </Text>
        {latency ? (
          <Text numberOfLines={1} style={{ color: latencyColor, fontSize: 10, fontWeight: "700", marginTop: 2 }}>
            {latency}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function cleanSourceName(name: string): string {
  return name.replace(/^(🎬|🔞)\s?/u, "");
}

function formatLatency(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "";
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

export function latencyColorForDuration(durationMs: number): string | null {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  if (durationMs < 1000) return LATENCY_GOOD;
  if (durationMs < 3000) return LATENCY_WARN;
  return LATENCY_BAD;
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: sizes.radius.sm, alignItems: "center" },
  textStack: { maxWidth: "100%", alignItems: "center" },
  bordered: { minWidth: 88, maxWidth: 140 },
  compact: { width: "100%" },
});
