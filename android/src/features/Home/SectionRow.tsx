// SectionRow renders a section title and a horizontal virtualised FlatList of VideoCards.
// SectionRow 渲染分区标题以及水平虚拟化 FlatList 形式的 VideoCard 列表.

import React, { useCallback } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import type { DoubanItem, HomeSection } from "@/api/types";
import { LIST_PERF_HORIZONTAL } from "@/designSystem/listPerf";
import { sizes } from "@/designSystem/theme";
import { useTheme } from "@/designSystem/useTheme";
import { VideoCard } from "@/designSystem/VideoCard";

interface Props {
  baseURL: string;
  section: HomeSection;
  onSelect?: (item: DoubanItem) => void;
}

const CARD_GAP = 12;
const CARD_STRIDE = sizes.cardWidth + CARD_GAP;

/**
 * SectionRow — section title + horizontal virtualised FlatList of VideoCards.
 * SectionRow — 分区标题加 VideoCard 的水平虚拟化 FlatList.
 */
export function SectionRow({ baseURL, section, onSelect }: Props) {
  const { colors } = useTheme();
  const keyExtractor = useCallback((it: DoubanItem) => it.id, []);
  const getItemLayout = useCallback(
    (_d: ArrayLike<DoubanItem> | null | undefined, i: number) => ({
      length: CARD_STRIDE,
      offset: CARD_STRIDE * i,
      index: i,
    }),
    [],
  );
  const renderItem = useCallback(({ item }: { item: DoubanItem }) => (
    <Pressable
      onPress={() => onSelect?.(item)}
      style={{ marginRight: CARD_GAP }}
      testID="sectionCard"
    >
      <VideoCard
        baseURL={baseURL}
        title={item.title}
        cover={item.cover}
        subtitle={item.year}
        rating={item.rate}
        width={sizes.cardWidth}
      />
    </Pressable>
  ), [baseURL, onSelect]);

  return (
    <View>
      <View style={styles.header}>
        <Text style={{ color: colors.textPrimary, fontSize: 17, fontWeight: "600" }}>{section.name}</Text>
      </View>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={section.items}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        contentContainerStyle={styles.list}
        {...LIST_PERF_HORIZONTAL}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  list: { paddingHorizontal: 16, paddingVertical: 6 },
});
