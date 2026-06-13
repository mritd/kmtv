// ContinueWatchingRow renders a horizontal row of WatchHistoryItem cards with a progress bar overlay.
// ContinueWatchingRow 渲染观看历史的水平行, 每张卡片带进度条遮罩.

import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { PosterImage } from "@/designSystem/PosterImage";
import { sizes } from "@/designSystem/theme";
import { useTheme } from "@/designSystem/useTheme";
import type { WatchHistoryItem } from "@/storage/watchHistory";

interface Props {
  baseURL: string;
  watchHistory: WatchHistoryItem[];
  onClear: () => void;
  onSelect?: (item: WatchHistoryItem) => void;
}

const baseStyles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  scrollerContent: { paddingHorizontal: 16, paddingVertical: 6 },
});

function progressTrack(bg: string) {
  return { width: sizes.cardWidth, height: 3, marginTop: 4, backgroundColor: bg, borderRadius: 1 };
}

function progressFill(color: string) {
  return { height: 3, backgroundColor: color, borderRadius: 1 };
}

/**
 * Continue Watching row — horizontal scroller of recent WatchHistoryItems with a progress overlay.
 * 继续观看行 — 最近观看历史的水平滚动条, 带进度遮罩.
 */
export function ContinueWatchingRow({ baseURL, watchHistory, onClear, onSelect }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation("home");

  if (watchHistory.length === 0) return null;

  const posterHeight = sizes.cardWidth * 1.5;

  return (
    <View>
      <View style={baseStyles.headerRow}>
        <Text style={{ color: colors.textPrimary, fontSize: 17, fontWeight: "600" }}>
          {t("continueWatching")}
        </Text>
        <Pressable onPress={onClear} testID="continueClear">
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
            {t("clear")}
          </Text>
        </Pressable>
      </View>

      {/* ScrollView + map renders every card up-front to match SectionRow's eager layout.
          watchHistory is capped at 10 by loadWatchHistory, well under any virtualisation threshold.
          ScrollView + map 与 SectionRow 一致, 一次性渲染全部卡片.
          loadWatchHistory 已将 watchHistory 限制为 10 条, 远低于需要虚拟化的规模. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={baseStyles.scrollerContent}>
        {watchHistory.map((entry) => {
          const ratio = entry.duration > 0 ? Math.min(1, entry.progress / entry.duration) : 0;
          return (
            <Pressable
              key={entry.id}
              onPress={() => onSelect?.(entry)}
              testID="continueCard"
              style={{ width: sizes.cardWidth, marginRight: 12 }}
            >
              <View style={{ width: sizes.cardWidth, height: posterHeight, borderRadius: sizes.radius.lg, overflow: "hidden" }}>
                <PosterImage baseURL={baseURL} cover={entry.cover} style={{ width: "100%", height: "100%" }} />
              </View>
              {entry.duration > 0 ? (
                <View style={progressTrack(colors.bgCard)} testID="continueProgressTrack">
                  <View style={[progressFill(colors.accent), { width: `${ratio * 100}%` }]} testID="continueProgressFill" />
                </View>
              ) : null}
              <Text numberOfLines={1} style={{ color: colors.textPrimary, fontSize: 12, marginTop: 4 }}>
                {entry.title}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
