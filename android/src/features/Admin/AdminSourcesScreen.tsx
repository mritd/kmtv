// AdminSourcesScreen — list, enable/disable, bulk enable-disable, check-all, delete (with confirm).
// AdminSourcesScreen — 源列表、启用/禁用、批量启用禁用、全部检查、二次确认删除.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, FlatList, Pressable, Switch, Text, View } from "react-native";

import { createAdminAPI, type AdminAPI } from "@/api/admin";
import { type APIError, localizedMessage } from "@/api/apiError";
import { createAPIClient } from "@/api/client";
import type { Source, UpdateSourceRequest } from "@/api/types";
import { useTheme } from "@/designSystem/useTheme";
import { useAuthStore } from "@/store/authStore";
import { useServerStore } from "@/store/serverStore";

/**
 * AdminSourcesScreenContextValue carries the AdminAPI binding for tests.
 * AdminSourcesScreenContextValue 为测试提供 AdminAPI 注入点.
 */
export interface AdminSourcesScreenContextValue {
  admin: AdminAPI;
}

/**
 * Optional injection context — tests override via Provider; production uses the default factory.
 * 可选注入 context, 测试通过 Provider 覆盖, 生产使用默认工厂.
 */
export const AdminSourcesScreenContext = createContext<AdminSourcesScreenContextValue | null>(null);

function useDefaultCtx(): AdminSourcesScreenContextValue | null {
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
 * AdminSourcesScreen — main sources management view.
 * AdminSourcesScreen — 源管理主视图.
 */
export function AdminSourcesScreen(){
  const injected = useContext(AdminSourcesScreenContext);
  const fallback = useDefaultCtx();
  const ctx = injected ?? fallback;
  const { colors } = useTheme();
  const { t } = useTranslation("admin");
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ctx) return;
    setLoading(true);
    try {
      setSources(await ctx.admin.listSources());
      setError(null);
    } catch (e) {
      setError(localizedMessage(e as APIError));
    } finally {
      setLoading(false);
    }
  }, [ctx]);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (s: Source, next: boolean) => {
    if (!ctx) return;
    const payload: UpdateSourceRequest = {
      name: s.name, api: s.api, detail: s.detail, comment: s.comment, enabled: next, is_adult: s.is_adult,
    };
    try {
      await ctx.admin.updateSource(s.id, payload);
      await load();
    } catch (e) {
      Alert.alert(t("common.error"), localizedMessage(e as APIError));
    }
  };

  const remove = (s: Source) => {
    Alert.alert(t("sources.confirmDeleteTitle"), t("sources.confirmDeleteMessage", { name: s.name }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"), style: "destructive", onPress: async () => {
          if (!ctx) return;
          try { await ctx.admin.deleteSource(s.id); await load(); }
          catch (e) { Alert.alert(t("common.error"), localizedMessage(e as APIError)); }
        },
      },
    ]);
  };

  const checkAll = async () => {
    if (!ctx) return;
    try {
      await ctx.admin.checkAllSources();
      setTimeout(() => { void load(); }, 5000);
    } catch (e) {
      Alert.alert(t("common.error"), localizedMessage(e as APIError));
    }
  };

  const bulk = async (enabled: boolean) => {
    if (!ctx || sources.length === 0) return;
    try {
      await ctx.admin.bulkSetSourcesEnabled({ ids: sources.map((s) => s.id), enabled });
      await load();
    } catch (e) {
      Alert.alert(t("common.error"), localizedMessage(e as APIError));
    }
  };

  if (loading && sources.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bgPrimary }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", padding: 12, gap: 8, flexWrap: "wrap" }}>
        <ActionButton testID="sourceEnableAll" label={t("sources.enableAll")} onPress={() => void bulk(true)} />
        <ActionButton testID="sourceDisableAll" label={t("sources.disableAll")} onPress={() => void bulk(false)} />
        <ActionButton testID="sourceCheckAll" label={t("sources.checkAll")} onPress={() => void checkAll()} />
      </View>
      {error ? <Text style={{ color: "#ef4444", paddingHorizontal: 16 }}>{error}</Text> : null}
      <FlatList
        data={sources}
        keyExtractor={(s) => String(s.id)}
        ListEmptyComponent={<Text style={{ padding: 24, color: colors.textSecondary }}>{t("sources.empty")}</Text>}
        renderItem={({ item }) => (
          <View style={{
            marginHorizontal: 16, marginTop: 8, padding: 12, borderRadius: 12,
            backgroundColor: colors.bgCard, flexDirection: "row", alignItems: "center",
          }}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View
                  testID={`sourceHealth-${item.id}`}
                  style={{
                    width: 8, height: 8, borderRadius: 4,
                    backgroundColor: item.health === "healthy" ? "#22c55e"
                      : item.health === "unhealthy" ? "#ef4444" : "#9ca3af",
                  }}
                />
                <Text style={{ color: colors.textPrimary, fontWeight: "600" }}>{item.name}</Text>
                {item.is_adult ? <Text style={{ color: "#ef4444", fontSize: 11 }}>{t("common.nsfw")}</Text> : null}
              </View>
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{item.key}</Text>
            </View>
            <Switch
              testID={`sourceToggle-${item.id}`}
              value={item.enabled}
              onValueChange={(v) => void toggle(item, v)}
            />
            <Pressable testID={`sourceDelete-${item.id}`} onPress={() => remove(item)} style={{ marginLeft: 12, padding: 8 }}>
              <Text style={{ color: "#ef4444" }}>{t("common.delete")}</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

function ActionButton(props: { testID: string; label: string; onPress: () => void }){
  const { colors } = useTheme();
  return (
    <Pressable
      testID={props.testID}
      onPress={props.onPress}
      style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.bgCard, borderRadius: 8 }}
    >
      <Text style={{ color: colors.textPrimary }}>{props.label}</Text>
    </Pressable>
  );
}
