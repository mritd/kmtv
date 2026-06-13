// PosterImage wraps expo-image with a theme-aware placeholder and URL resolver.
// PosterImage 封装 expo-image, 提供主题感知的占位图与 URL 解析.

import { Image, type ImageStyle as ExpoImageStyle } from "expo-image";
import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "./useTheme";

/**
 * Join a relative cover path to baseURL, mirroring iOS heroImageURL().
 * 拼接相对 cover 与 baseURL, 与 iOS heroImageURL() 行为一致.
 */
export function resolvePosterURL(baseURL: string, cover: string): string | null {
  if (!cover) return null;
  if (/^https?:\/\//i.test(cover)) return cover;
  if (cover.startsWith("/")) {
    const trimmed = baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL;
    return `${trimmed}${cover}`;
  }
  return cover;
}

interface Props {
  baseURL: string;
  cover: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  contentFit?: "cover" | "contain";
}

/**
 * PosterImage shows a theme-coloured placeholder when no cover is provided,
 * and an expo-image otherwise.
 * 当未提供 cover 时显示主题占位图, 否则使用 expo-image.
 */
export function PosterImage({ baseURL, cover, style, testID, contentFit = "cover" }: Props) {
  const { colors } = useTheme();
  const url = resolvePosterURL(baseURL, cover);
  if (!url) {
    return (
      <View
        testID={testID ? `${testID}-placeholder` : "poster-placeholder"}
        style={[{ backgroundColor: colors.bgCard }, style]}
      />
    );
  }
  return (
    <Image
      testID={testID ?? "expo-image"}
      source={url}
      style={style as StyleProp<ExpoImageStyle>}
      contentFit={contentFit}
      transition={250}
    />
  );
}
