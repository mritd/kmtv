// ProfileScreen — composes all profile sub-sections and wires them to authStore + serverStore.
// ProfileScreen — 组装 Profile 各子节, 接入 authStore + serverStore.

import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React, { createContext, useContext, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { createAuthAPI, type AuthAPI } from "@/api/auth";
import { createAPIClient, type APIClient } from "@/api/client";
import { useTheme } from "@/designSystem/useTheme";
import type { ProfileStackParamList } from "@/navigation/types";
import { useAuthStore } from "@/store/authStore";
import { useServerStore } from "@/store/serverStore";

import { LanguageSection } from "./LanguageSection";
import { PasswordSection } from "./PasswordSection";
import { ThemeSection } from "./ThemeSection";
import { UserInfoSection } from "./UserInfoSection";
import { useProfile } from "./useProfile";

/**
 * Context value to inject stubbed apiClient + auth in tests; nullable when default factory is fine.
 * 测试时注入 stub apiClient + auth 的 context, 默认工厂可用时传 null.
 */
export interface ProfileScreenContextValue {
  apiClient: APIClient;
  auth: AuthAPI;
}

/**
 * Optional ProfileScreen context for tests.
 * ProfileScreen 的可选 context, 主要用于测试.
 */
export const ProfileScreenContext = createContext<ProfileScreenContextValue | null>(null);

function useDefaultContext(): ProfileScreenContextValue | null {
  const serverURL = useServerStore((s) => s.serverURL) ?? "";
  return useMemo(() => {
    if (!serverURL) return null;
    const client = createAPIClient({
      baseURL: serverURL,
      getToken: () => useAuthStore.getState().token,
      onUnauthorized: () => useAuthStore.getState().handleAuthExpired(),
    });
    return { apiClient: client, auth: createAuthAPI(client) };
  }, [serverURL]);
}

/**
 * Inner ProfileScreen — owns the `useProfile` hook. Only mounted once `ctx` is non-null so the
 * hook's deps are stable for the lifetime of the component.
 * ProfileScreen 的内层组件 — 持有 useProfile hook. 仅当 ctx 非空时挂载, 保证 hook 依赖稳定.
 */
function ProfileInner({ ctx }: { ctx: ProfileScreenContextValue }) {
  const { colors } = useTheme();
  const { t } = useTranslation("profile");
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const logout = useAuthStore((s) => s.logout);
  const serverURL = useServerStore((s) => s.serverURL) ?? "";

  const profile = useProfile({ auth: ctx.auth, user, serverURL, onUserChanged: updateUser });

  useEffect(() => { profile.refreshWatchCount(); }, [profile]);

  const isAnonymous = !user || user.id === 0;

  const confirmSignOut = () => {
    Alert.alert(t("danger.signOut"), undefined, [
      { text: t("username.cancel"), style: "cancel" },
      { text: t("danger.signOut"), style: "destructive", onPress: () => void logout() },
    ]);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
      <UserInfoSection
        user={user}
        isAnonymous={isAnonymous}
        apiClient={ctx.apiClient}
        serverURL={serverURL}
        profile={profile}
      />
      {user?.role === "admin" ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate("AdminPanel")}
          style={[styles.adminRow, { backgroundColor: colors.bgCard }]}
          testID="adminEntry"
        >
          <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: "500" }}>
            {t("admin:entry.row")}
          </Text>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </Pressable>
      ) : null}
      {!isAnonymous ? <PasswordSection profile={profile} /> : null}
      <LanguageSection />
      <ThemeSection />
      <View style={styles.danger}>
        <Pressable
          testID="clearHistoryButton"
          onPress={profile.clearWatchHistory}
          style={styles.dangerBtn}
          accessibilityRole="button"
        >
          <Text style={{ color: "#d33", fontSize: 15 }}>{t("danger.clearHistory")}</Text>
        </Pressable>
        <Pressable
          testID="signOutButton"
          onPress={confirmSignOut}
          style={styles.dangerBtn}
          accessibilityRole="button"
        >
          <Text style={{ color: "#d33", fontSize: 15, fontWeight: "700" }}>{t("danger.signOut")}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/**
 * ProfileScreen — Me tab root.
 * ProfileScreen — Me Tab 的根.
 */
export function ProfileScreen() {
  const ctxFromProps = useContext(ProfileScreenContext);
  const fallback = useDefaultContext();
  const ctx = ctxFromProps ?? fallback;
  if (!ctx) return null;
  return <ProfileInner ctx={ctx} />;
}

const styles = StyleSheet.create({
  danger: { paddingHorizontal: 16, paddingVertical: 16, gap: 8 },
  dangerBtn: { paddingVertical: 12 },
  adminRow: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
