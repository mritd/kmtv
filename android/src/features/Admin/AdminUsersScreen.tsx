// AdminUsersScreen — list, add user with role/allow_adult, delete with self-guard + confirm.
// AdminUsersScreen — 列表、含角色与 NSFW 的新增、自身保护 + 二次确认删除.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, FlatList, Pressable, Switch, Text, TextInput, View } from "react-native";

import { createAdminAPI, type AdminAPI } from "@/api/admin";
import { type APIError, localizedMessage } from "@/api/apiError";
import { createAPIClient } from "@/api/client";
import type { AdminUser } from "@/api/types";
import { useTheme } from "@/designSystem/useTheme";
import { useAuthStore } from "@/store/authStore";
import { useServerStore } from "@/store/serverStore";

/**
 * AdminUsersScreenContextValue — admin binding for tests.
 * AdminUsersScreenContextValue — 为测试提供 admin 绑定.
 */
export interface AdminUsersScreenContextValue {
  admin: AdminAPI;
}

/**
 * AdminUsersScreenContext — null-by-default; tests inject via Provider.
 * AdminUsersScreenContext — 默认 null, 测试通过 Provider 注入.
 */
export const AdminUsersScreenContext = createContext<AdminUsersScreenContextValue | null>(null);

function useDefaultCtx(): AdminUsersScreenContextValue | null {
  const serverURL = useServerStore((s) => s.serverURL) ?? "";
  return useMemo(() => {
    if (!serverURL) return null;
    const client = createAPIClient({
      baseURL: serverURL,
      getToken: () => useAuthStore.getState().token,
      onUnauthorized: () => useAuthStore.getState().handleAuthExpired(),
    });
    return { admin: createAdminAPI(client) };
  }, [serverURL]);
}

/**
 * AdminUsersScreen — user management view (admin only).
 * AdminUsersScreen — 用户管理视图 (仅管理员).
 */
export function AdminUsersScreen(){
  const injected = useContext(AdminUsersScreenContext);
  const fallback = useDefaultCtx();
  const ctx = injected ?? fallback;
  const { colors } = useTheme();
  const { t } = useTranslation("admin");
  const currentUserId = useAuthStore((s) => s.user?.id) ?? 0;
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [allowAdult, setAllowAdult] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ctx) return;
    setLoading(true);
    try { setUsers(await ctx.admin.listUsers()); }
    finally { setLoading(false); }
  }, [ctx]);

  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (password !== confirm) {
      setFormError(t("users.passwordMismatch"));
      return;
    }
    try {
      await ctx!.admin.createUser({ username, password, role, allow_adult_content: allowAdult });
      setAddOpen(false);
      setUsername(""); setPassword(""); setConfirm(""); setRole("user"); setAllowAdult(false);
      setFormError(null);
      await load();
    } catch (e) {
      setFormError(localizedMessage(e as APIError));
    }
  };

  const remove = (u: AdminUser) => {
    if (u.id === currentUserId) {
      Alert.alert(t("common.error"), t("users.cannotDeleteSelf"));
      return;
    }
    Alert.alert(t("users.confirmDeleteTitle"), t("users.confirmDeleteMessage", { username: u.username }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"), style: "destructive", onPress: async () => {
          try { await ctx!.admin.deleteUser(u.id); await load(); }
          catch (e) { Alert.alert(t("common.error"), localizedMessage(e as APIError)); }
        },
      },
    ]);
  };

  if (loading && users.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bgPrimary }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", padding: 12 }}>
        <Pressable
          testID="userAddOpen"
          onPress={() => setAddOpen((v) => !v)}
          style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.bgCard, borderRadius: 8 }}
        >
          <Text style={{ color: colors.textPrimary }}>{t("users.add")}</Text>
        </Pressable>
      </View>
      {addOpen ? (
        <View style={{ marginHorizontal: 16, padding: 12, gap: 8, backgroundColor: colors.bgCard, borderRadius: 12 }}>
          <TextInput
            testID="userUsernameInput"
            placeholder={t("users.username")}
            placeholderTextColor={colors.textSecondary}
            value={username}
            onChangeText={setUsername}
            style={{ backgroundColor: colors.bgPrimary, borderRadius: 6, padding: 8, color: colors.textPrimary }}
          />
          <TextInput
            testID="userPasswordInput"
            placeholder={t("users.password")}
            placeholderTextColor={colors.textSecondary}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            style={{ backgroundColor: colors.bgPrimary, borderRadius: 6, padding: 8, color: colors.textPrimary }}
          />
          <TextInput
            testID="userConfirmInput"
            placeholder={t("users.passwordConfirm")}
            placeholderTextColor={colors.textSecondary}
            secureTextEntry
            value={confirm}
            onChangeText={setConfirm}
            style={{ backgroundColor: colors.bgPrimary, borderRadius: 6, padding: 8, color: colors.textPrimary }}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            {(["user", "admin"] as const).map((r) => (
              <Pressable
                key={r}
                testID={`userRole-${r}`}
                onPress={() => setRole(r)}
                style={{
                  paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
                  backgroundColor: role === r ? colors.accent : colors.bgPrimary,
                }}
              >
                <Text style={{ color: role === r ? "#fff" : colors.textPrimary }}>
                  {r === "admin" ? t("users.roleAdmin") : t("users.roleUser")}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: colors.textPrimary }}>{t("users.allowAdult")}</Text>
            <Switch value={allowAdult} onValueChange={setAllowAdult} />
          </View>
          {formError ? <Text style={{ color: "#ef4444" }}>{formError}</Text> : null}
          <Pressable
            testID="userSubmit"
            onPress={() => void submit()}
            style={{ alignSelf: "flex-end", paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.accent, borderRadius: 8 }}
          >
            <Text style={{ color: "#fff" }}>{t("common.save")}</Text>
          </Pressable>
        </View>
      ) : null}
      <FlatList
        data={users}
        keyExtractor={(u) => String(u.id)}
        ListEmptyComponent={<Text style={{ padding: 24, color: colors.textSecondary }}>{t("users.empty")}</Text>}
        renderItem={({ item }) => (
          <View style={{
            marginHorizontal: 16, marginTop: 8, padding: 12, backgroundColor: colors.bgCard, borderRadius: 12,
            flexDirection: "row", alignItems: "center",
          }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.textPrimary, fontWeight: "600" }}>{item.username}</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                {item.role === "admin" ? t("users.roleAdmin") : t("users.roleUser")}
                {item.allow_adult_content ? "  ·  NSFW" : ""}
              </Text>
            </View>
            <Pressable testID={`userDelete-${item.id}`} onPress={() => remove(item)}>
              <Text style={{ color: "#ef4444" }}>{t("common.delete")}</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}
