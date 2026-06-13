// ProfileStack — wraps ProfileScreen and the four admin sub-screens under one native-stack.
// ProfileStack — 在同一个 native-stack 下装载 ProfileScreen 与四个管理子页面.

import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { useTranslation } from "react-i18next";

import { AdminPanelScreen } from "@/features/Admin/AdminPanelScreen";
import { AdminSettingsScreen } from "@/features/Admin/AdminSettingsScreen";
import { AdminSourcesScreen } from "@/features/Admin/AdminSourcesScreen";
import { AdminSubscriptionsScreen } from "@/features/Admin/AdminSubscriptionsScreen";
import { AdminUsersScreen } from "@/features/Admin/AdminUsersScreen";
import { ProfileScreen } from "@/features/Profile/ProfileScreen";

import type { ProfileStackParamList } from "./types";

const Stack = createNativeStackNavigator<ProfileStackParamList>();

/**
 * ProfileStack renders the profile root and pushes admin screens on top when reached.
 * ProfileStack 渲染 profile 根页, 进入管理时在其上 push 管理页面.
 */
export function ProfileStack(){
  const { t } = useTranslation("admin");
  return (
    <Stack.Navigator>
      <Stack.Screen name="ProfileRoot" component={ProfileScreen} options={{ headerShown: false }} />
      <Stack.Screen name="AdminPanel" component={AdminPanelScreen} options={{ title: t("panel.title") }} />
      <Stack.Screen name="AdminSources" component={AdminSourcesScreen} options={{ title: t("panel.sources") }} />
      <Stack.Screen name="AdminSubscriptions" component={AdminSubscriptionsScreen} options={{ title: t("panel.subscriptions") }} />
      <Stack.Screen name="AdminUsers" component={AdminUsersScreen} options={{ title: t("panel.users") }} />
      <Stack.Screen name="AdminSettings" component={AdminSettingsScreen} options={{ title: t("panel.settings") }} />
    </Stack.Navigator>
  );
}
