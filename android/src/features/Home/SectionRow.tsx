// SectionRow renders a section title and a horizontal FlatList of VideoCards.
// SectionRow 渲染分区标题以及水平 FlatList 形式的 VideoCard 列表.

import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { DoubanItem, HomeSection } from "@/api/types";
import { VideoCard } from "@/designSystem/VideoCard";
import { sizes } from "@/designSystem/theme";
import { useTheme } from "@/designSystem/useTheme";

interface Props {
  baseURL: string;
  section: HomeSection;
  onSelect?: (item: DoubanItem) => void;
}

/**
 * SectionRow — section title + horizontal poster row of VideoCards.
 * SectionRow — 分区标题加 VideoCard 的水平海报行.
 */
export function SectionRow({ baseURL, section, onSelect }: Props) {
  const { colors } = useTheme();
  return (
    <View>
      <View style={styles.header}>
        <Text style={{ color: colors.textPrimary, fontSize: 17, fontWeight: "600" }}>{section.name}</Text>
      </View>
      {/* ScrollView + map renders every poster up-front, matching iOS LazyHStack's eager layout
          and keeping integration tests deterministic. Virtualisation can be reintroduced later
          if a section ever exceeds 50+ posters; current home feed sections are ~20.
          ScrollView + map 一次性渲染全部海报, 与 iOS LazyHStack 渲染节奏一致, 同时让集成
          测试保持确定性. 若未来某分区超过 50+ 项再考虑重新引入虚拟化, 当前首页分区约 20 项. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.list}>
        {section.items.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => onSelect?.(item)}
            style={{ marginRight: 12 }}
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
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  list: { paddingHorizontal: 16, paddingVertical: 6 },
});
