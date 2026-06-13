// FavoritesStack — nested native-stack hosted by FavoritesTab: list -> Detail -> Player.
// FavoritesStack — FavoritesTab 内的 native-stack: 列表 -> Detail -> Player.

import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/designSystem/useTheme";
import { FavoritesScreen } from "@/features/Favorites/FavoritesScreen";
import { DetailScreen } from "@/features/Playback/DetailScreen";
import { PlayerScreen } from "@/features/Playback/PlayerScreen";

import type { FavoritesStackParamList } from "./types";

const Stack = createNativeStackNavigator<FavoritesStackParamList>();

/**
 * Native-stack hosted by FavoritesTab.
 * FavoritesTab 内挂载的 native-stack.
 */
export function FavoritesStack() {
  const { colors } = useTheme();
  const { t } = useTranslation("favorites");
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.bgSecondary },
        headerTintColor: colors.textPrimary,
      }}
    >
      <Stack.Screen name="FavoritesRoot" component={FavoritesScreen} options={{ title: t("title") }} />
      <Stack.Screen name="Detail" component={DetailScreen} options={{ title: "" }} />
      <Stack.Screen name="Player" component={PlayerScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
