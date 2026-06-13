// HeroCarousel: paging horizontal FlatList + 5 s auto-advance + dot indicator + bottom scrim overlay.
// HeroCarousel: 水平分页 FlatList + 5 秒自动滚动 + 圆点指示器 + 底部遮罩.

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import type { DoubanItem } from "@/api/types";
import { useLayoutWidth } from "@/designSystem/breakpoints";
import { PosterImage } from "@/designSystem/PosterImage";
import { sizes } from "@/designSystem/theme";
import { useTheme } from "@/designSystem/useTheme";

const AUTO_ADVANCE_MS = 5000;

interface Props {
  baseURL: string;
  items: DoubanItem[];
  onSelect?: (item: DoubanItem) => void;
}

/**
 * HeroCarousel — full-width paging FlatList that auto-advances every 5 s.
 * HeroCarousel — 全宽分页 FlatList, 每 5 秒自动滚动.
 */
export function HeroCarousel({ baseURL, items, onSelect }: Props) {
  const { colors } = useTheme();
  const { width: viewportWidth } = useWindowDimensions();
  const layout = useLayoutWidth();
  const isTablet = layout !== "phone";
  const height = isTablet ? sizes.heroHeightTablet : sizes.heroHeight;
  const listRef = useRef<FlatList<DoubanItem>>(null);
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  indexRef.current = index;

  useEffect(() => {
    if (items.length < 2) return;
    const t = setInterval(() => {
      const next = (indexRef.current + 1) % items.length;
      indexRef.current = next;
      setIndex(next);
      listRef.current?.scrollToIndex({ index: next, animated: true });
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(t);
  }, [items.length]);

  const onMomentumScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / viewportWidth);
    indexRef.current = next;
    setIndex(next);
  }, [viewportWidth]);

  if (items.length === 0) return null;

  return (
    <View style={{ width: viewportWidth, height }}>
      <FlatList
        ref={listRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        data={items}
        keyExtractor={(it) => it.id}
        onMomentumScrollEnd={onMomentumScrollEnd}
        getItemLayout={(_d, i) => ({ length: viewportWidth, offset: viewportWidth * i, index: i })}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onSelect?.(item)}
            style={{ width: viewportWidth, height }}
            testID="heroSlidePressable"
          >
            <PosterImage
              baseURL={baseURL}
              cover={item.cover}
              style={{ width: viewportWidth, height }}
              testID="heroSlide"
            />
            {/* Solid bottom scrim approximating iOS's LinearGradient (HomeView.swift:250-254).
                A multi-stop gradient lands with expo-linear-gradient in M4.
                单色底部遮罩, 近似 iOS LinearGradient (HomeView.swift:250-254).
                真正多端点渐变在 M4 引入 expo-linear-gradient 时一并补齐. */}
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: 0, right: 0, bottom: 0,
                height: Math.round(height * 0.45),
                backgroundColor: colors.bgPrimary,
                opacity: 0.55,
              }}
              testID="heroScrim"
            />
            <View style={{ position: "absolute", left: 16, right: 16, bottom: 20 }}>
              <Text style={{ color: colors.textPrimary, fontSize: 22, fontWeight: "700" }}>{item.title}</Text>
              {(item.year.length > 0 || (item.rate.length > 0 && item.rate !== "0")) && (
                <View style={{ flexDirection: "row", marginTop: 4 }}>
                  {item.year.length > 0 && (
                    <Text style={{ color: colors.textSecondary, fontSize: 12, marginRight: 8 }}>{item.year}</Text>
                  )}
                  {item.rate.length > 0 && item.rate !== "0" && (
                    <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{`⭐ ${item.rate}`}</Text>
                  )}
                </View>
              )}
            </View>
          </Pressable>
        )}
      />
      <View style={styles.dots} pointerEvents="none">
        {items.map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { backgroundColor: i === index ? colors.accent : colors.textSecondary, opacity: i === index ? 1 : 0.4 },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dots: { position: "absolute", bottom: 8, left: 0, right: 0, flexDirection: "row", justifyContent: "center" },
  dot: { width: 6, height: 6, borderRadius: 3, marginHorizontal: 3 },
});
