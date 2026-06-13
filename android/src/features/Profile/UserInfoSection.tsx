// UserInfoSection — avatar + username + role + server. Triggers Alert for avatar actions.
// UserInfoSection — 头像 + 用户名 + 角色 + 服务器. 通过 Alert 触发头像相关操作.

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { APIClient } from "@/api/client";
import type { User } from "@/api/types";
import { IconButton } from "@/designSystem/IconButton";
import { useTheme } from "@/designSystem/useTheme";

import { AuthenticatedAvatarImage } from "./AuthenticatedAvatarImage";
import type { UseProfileResult } from "./useProfile";

/**
 * Props for UserInfoSection.
 * UserInfoSection 的 props.
 */
export interface UserInfoSectionProps {
  user: User | null;
  isAnonymous: boolean;
  apiClient: APIClient | null;
  serverURL: string;
  profile: UseProfileResult;
}

/**
 * UserInfoSection — top section of ProfileScreen.
 * UserInfoSection — ProfileScreen 顶部信息区.
 */
export function UserInfoSection({ user, isAnonymous, apiClient, serverURL, profile }: UserInfoSectionProps) {
  const { colors } = useTheme();
  const { t } = useTranslation("profile");

  const onAvatarPress = () => {
    const hasAvatar = !!user?.avatar;
    const buttons: Array<{ text: string; style?: "cancel" | "destructive" | "default"; onPress?: () => void }> = [
      { text: t("username.cancel"), style: "cancel" },
      { text: t("avatar.change"), onPress: () => void profile.pickAndUploadAvatar() },
    ];
    if (hasAvatar) {
      buttons.push({ text: t("avatar.remove"), style: "destructive", onPress: () => void profile.deleteAvatar() });
    }
    Alert.alert(t("avatar.change"), undefined, buttons);
  };

  const avatarContent = (
    <View testID="avatarCircle" style={[styles.avatar, { backgroundColor: colors.bgCard }]}>
      {user?.avatar ? (
        <AuthenticatedAvatarImage apiClient={apiClient} path={user.avatar} size={56} />
      ) : (
        <Text style={[styles.initial, { color: colors.textSecondary }]}>
          {(user?.username ?? "?").charAt(0).toUpperCase()}
        </Text>
      )}
    </View>
  );

  return (
    <View style={[styles.section, { backgroundColor: colors.bgCard }]}>
      <View style={styles.row}>
        {isAnonymous ? avatarContent : (
          <Pressable testID="avatarPressable" onPress={onAvatarPress} accessibilityRole="button" accessibilityLabel={t("avatar.change")}>
            {avatarContent}
          </Pressable>
        )}
        <View style={styles.info}>
          {isAnonymous ? (
            <Text testID="anonymousUserLabel" style={[styles.username, { color: colors.textPrimary }]}>
              {t("anonymous")}
            </Text>
          ) : profile.isEditingUsername ? (
            <View style={styles.editRow}>
              <TextInput
                testID="usernameInput"
                value={profile.editUsername}
                onChangeText={profile.setEditUsername}
                placeholder={t("username.placeholder")}
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.bgPrimary }]}
              />
              <IconButton
                testID="confirmUsernameButton"
                name="checkmark-circle"
                onPress={() => void profile.submitUsername()}
                accessibilityLabel={t("username.confirm")}
                disabled={profile.editUsername.trim().length === 0}
                color={colors.accent}
              />
              <IconButton
                testID="cancelUsernameButton"
                name="close-circle"
                onPress={profile.cancelEditUsername}
                accessibilityLabel={t("username.cancel")}
              />
            </View>
          ) : (
            <View style={styles.editRow}>
              <Text style={[styles.username, { color: colors.textPrimary }]}>
                {user?.username ?? ""}
              </Text>
              <IconButton
                testID="editUsernameButton"
                name="pencil"
                size={16}
                onPress={profile.startEditUsername}
                accessibilityLabel={t("username.edit")}
              />
            </View>
          )}
          {!isAnonymous && user ? (
            <View
              testID="roleBadge"
              style={[styles.badge, {
                backgroundColor: (user.role === "admin" ? "#f59e0b" : "#10b981") + "33",
              }]}
            >
              <Text style={{
                color: user.role === "admin" ? "#f59e0b" : "#10b981",
                fontSize: 11,
                fontWeight: "700",
              }}>
                {user.role === "admin" ? t("role.admin") : t("role.user")}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <View style={styles.serverRow}>
        <Ionicons name="server" size={14} color={colors.textSecondary} />
        <Text style={[styles.serverText, { color: colors.textSecondary }]} numberOfLines={1}>{serverURL}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { padding: 16, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 16 },
  avatar: { width: 60, height: 60, borderRadius: 999, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  initial: { fontSize: 20, fontWeight: "700" },
  info: { flex: 1, gap: 4 },
  editRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  username: { fontSize: 17, fontWeight: "700" },
  input: { flex: 1, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, fontSize: 15 },
  badge: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  serverRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  serverText: { fontSize: 12, flex: 1 },
});
