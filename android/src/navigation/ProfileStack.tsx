// ProfileStack — wraps ProfileScreen and the four admin sub-screens under one native-stack.
// ProfileStack — 在同一个 native-stack 下装载 ProfileScreen 与四个管理子页面.

import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { useTranslation } from "react-i18next";

import { useTheme } from "@/designSystem/useTheme";
import { AdminPanelScreen } from "@/features/Admin/AdminPanelScreen";
import { AdminSettingsScreen } from "@/features/Admin/AdminSettingsScreen";
import { AdminSourcesScreen } from "@/features/Admin/AdminSourcesScreen";
import { AdminSubscriptionsScreen } from "@/features/Admin/AdminSubscriptionsScreen";
import { AdminUsersScreen } from "@/features/Admin/AdminUsersScreen";
import { DiagnosticsScreen } from "@/features/Diagnostics/DiagnosticsScreen";
import { ProfileScreen } from "@/features/Profile/ProfileScreen";

import type { ProfileStackParamList } from "./types";

const Stack = createNativeStackNavigator<ProfileStackParamList>();

/**
 * ProfileStack renders the profile root and pushes admin screens on top when reached.
 * ProfileStack 渲染 profile 根页, 进入管理时在其上 push 管理页面.
 */
export function ProfileStack(){
  const { colors } = useTheme();
  const { t } = useTranslation("admin");
  return (
    // The default native-stack header is light-on-light and ignores the dark theme, so admin sub-screens
    // ended up with a white header on a black body. Mirror FavoritesStack's theme-aware screenOptions.
    // native-stack 默认 header 是浅色, 不跟随深色主题, 导致 admin 子页面顶栏白底黑字与全局深色不协调. 沿用
    // FavoritesStack 的主题感知 screenOptions.
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.bgSecondary },
        headerTintColor: colors.textPrimary,
      }}
    >
      <Stack.Screen name="ProfileRoot" component={ProfileScreen} options={{ headerShown: false }} />
      <Stack.Screen name="AdminPanel" component={AdminPanelScreen} options={{ title: t("panel.title") }} />
      <Stack.Screen name="AdminSources" component={AdminSourcesScreen} options={{ title: t("panel.sources") }} />
      <Stack.Screen name="AdminSubscriptions" component={AdminSubscriptionsScreen} options={{ title: t("panel.subscriptions") }} />
      <Stack.Screen name="AdminUsers" component={AdminUsersScreen} options={{ title: t("panel.users") }} />
      <Stack.Screen name="AdminSettings" component={AdminSettingsScreen} options={{ title: t("panel.settings") }} />
      <Stack.Screen name="Diagnostics" component={DiagnosticsScreen} options={{ title: t("diagnostics:title") }} />
    </Stack.Navigator>
  );
}
