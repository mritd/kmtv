// EpisodeGrid — adaptive grid of episode pills, mirrors iOS LazyVGrid.adaptive.
// EpisodeGrid — 自适应剧集胶囊网格, 镜像 iOS LazyVGrid.adaptive.

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { Episode } from "@/api/types";
import { sizes } from "@/designSystem/theme";
import { useTheme } from "@/designSystem/useTheme";

/**
 * Props — episode list + currently playing index + tap handler.
 * Props — 剧集列表、当前播放索引、点击回调.
 */
export interface EpisodeGridProps {
  episodes: Episode[];
  currentIndex: number;
  onSelect: (index: number) => void;
}

/**
 * EpisodeGrid — 4-column grid of episode pills. Density tuned for phone-portrait; tablet polish
 * lands in M7.
 * EpisodeGrid — 4 列剧集胶囊, 手机竖屏密度, 平板细节调优在 M7.
 */
export function EpisodeGrid({ episodes, currentIndex, onSelect }: EpisodeGridProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.grid}>
      {episodes.map((ep, index) => {
        const selected = index === currentIndex;
        return (
          <View key={`${index}-${ep.name}`} style={styles.cell}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onSelect(index)}
              style={[
                styles.pill,
                { backgroundColor: selected ? colors.accent : colors.bgCard },
              ]}
            >
              <Text
                numberOfLines={1}
                style={{ color: selected ? "white" : colors.textPrimary, fontSize: 12, fontWeight: "500" }}
              >
                {ep.name}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "25%", padding: 3 },
  pill: { paddingVertical: 8, paddingHorizontal: 6, borderRadius: sizes.radius.sm, alignItems: "center" },
});
