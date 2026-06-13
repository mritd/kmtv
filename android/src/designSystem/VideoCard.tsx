// VideoCard mirrors apple/Shared/DesignSystem/Components/VideoCard.swift on iOS.
// VideoCard 与 apple/Shared/DesignSystem/Components/VideoCard.swift 保持一致.

import React from "react";
import { Text, View } from "react-native";

import { PosterImage } from "./PosterImage";
import { sizes } from "./theme";
import { useTheme } from "./useTheme";

interface Props {
  baseURL: string;
  title: string;
  cover: string;
  subtitle?: string;
  rating?: string;
  width?: number;
}

/**
 * Resolve the rating label, mirroring VideoCard.swift's fallback to "N/A".
 * 解析评分标签, 与 VideoCard.swift 中回退到 "N/A" 的逻辑一致.
 */
function ratingLabel(rating: string | undefined): string {
  if (!rating || rating === "0") return "N/A";
  return rating;
}

/**
 * VideoCard renders a 2:3 poster with a rating badge, title, and optional subtitle.
 * VideoCard 渲染 2:3 海报, 包含评分徽章、标题以及可选副标题.
 */
export function VideoCard({ baseURL, title, cover, subtitle, rating, width = sizes.cardWidth }: Props) {
  const { colors } = useTheme();
  const posterHeight = width * 1.5;
  return (
    <View style={{ width }}>
      <View style={{ width, height: posterHeight, borderRadius: sizes.radius.lg, overflow: "hidden" }}>
        <PosterImage
          baseURL={baseURL}
          cover={cover}
          style={{ width: "100%", height: "100%" }}
          testID="videoCard-poster"
        />
        <View
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            paddingHorizontal: 4,
            paddingVertical: 2,
            backgroundColor: colors.ratingBadgeBg,
            borderRadius: sizes.radius.sm,
          }}
        >
          <Text
            testID="videoCard-rating"
            style={{ color: colors.accent, fontSize: 10, fontWeight: "700", fontVariant: ["tabular-nums"] }}
          >
            {ratingLabel(rating)}
          </Text>
        </View>
      </View>
      <Text
        testID="videoCard-title"
        numberOfLines={1}
        style={{ color: colors.textPrimary, fontSize: 12, marginTop: 4 }}
      >
        {title}
      </Text>
      {subtitle && subtitle.length > 0 ? (
        <Text
          testID="videoCard-subtitle"
          numberOfLines={1}
          style={{ color: colors.textSecondary, fontSize: 11 }}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
