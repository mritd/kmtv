// AdminSubscriptionsScreen — list, create with URL validation, sync, delete-with-confirm.
// AdminSubscriptionsScreen — 列表、含 URL 校验的创建、同步、二次确认删除.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, FlatList, Pressable, Switch, Text, TextInput, View } from "react-native";

import { createAdminAPI, type AdminAPI } from "@/api/admin";
import { type APIError, localizedMessage } from "@/api/apiError";
import { createAPIClient } from "@/api/client";
import type { CreateSubscriptionRequest, Subscription } from "@/api/types";
import { LIST_PERF_DEFAULT } from "@/designSystem/listPerf";
import { useTheme } from "@/designSystem/useTheme";
import { useAuthStore } from "@/store/authStore";
import { useServerStore } from "@/store/serverStore";

const DEFAULT_INTERVAL = 86400;

/**
 * AdminSubscriptionsScreenContextValue — admin binding for tests.
 * AdminSubscriptionsScreenContextValue — 为测试提供 admin 绑定.
 */
export interface AdminSubscriptionsScreenContextValue {
  admin: AdminAPI;
}

/**
 * AdminSubscriptionsScreenContext — null-by-default; tests inject via Provider.
 * AdminSubscriptionsScreenContext — 默认 null, 测试通过 Provider 注入.
 */
export const AdminSubscriptionsScreenContext = createContext<AdminSubscriptionsScreenContextValue | null>(null);

function useDefaultCtx(): AdminSubscriptionsScreenContextValue | null {
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
 * AdminSubscriptionsScreen — subscription management view.
 * AdminSubscriptionsScreen — 订阅管理视图.
 */
export function AdminSubscriptionsScreen(){
  const injected = useContext(AdminSubscriptionsScreenContext);
  const fallback = useDefaultCtx();
  const ctx = injected ?? fallback;
  const { colors } = useTheme();
  const { t } = useTranslation("admin");
  const [items, setItems] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState<CreateSubscriptionRequest>({
    url: "", auto_update: true, interval: DEFAULT_INTERVAL,
  });
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ctx) return;
    setLoading(true);
    try { setItems(await ctx.admin.listSubscriptions()); }
    finally { setLoading(false); }
  }, [ctx]);

  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (!/^https?:\/\//i.test(draft.url)) {
      setFormError(t("subscriptions.invalidUrl"));
      return;
    }
    try {
      await ctx!.admin.createSubscription({
        url: draft.url.trim(),
        auto_update: draft.auto_update,
        interval: Math.max(60, Number.isFinite(draft.interval) ? draft.interval : DEFAULT_INTERVAL),
      });
      setAddOpen(false);
      setDraft({ url: "", auto_update: true, interval: DEFAULT_INTERVAL });
      setFormError(null);
      await load();
    } catch (e) {
      setFormError(localizedMessage(e as APIError));
    }
  };

  const sync = async (id: number) => {
    try { await ctx!.admin.syncSubscription(id); await load(); }
    catch (e) { Alert.alert(t("common.error"), localizedMessage(e as APIError)); }
  };

  const remove = (item: Subscription) => {
    Alert.alert(t("subscriptions.confirmDeleteTitle"), t("subscriptions.confirmDeleteMessage", { url: item.url }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"), style: "destructive", onPress: async () => {
          try { await ctx!.admin.deleteSubscription(item.id); await load(); }
          catch (e) { Alert.alert(t("common.error"), localizedMessage(e as APIError)); }
        },
      },
    ]);
  };

  if (loading && items.length === 0) {
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
          testID="subAddOpen"
          onPress={() => setAddOpen((v) => !v)}
          style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.bgCard, borderRadius: 8 }}
        >
          <Text style={{ color: colors.textPrimary }}>{t("subscriptions.add")}</Text>
        </Pressable>
      </View>
      {addOpen ? (
        <View style={{ marginHorizontal: 16, padding: 12, gap: 8, backgroundColor: colors.bgCard, borderRadius: 12 }}>
          <TextInput
            testID="subUrlInput"
            placeholder={t("subscriptions.url")}
            placeholderTextColor={colors.textSecondary}
            value={draft.url}
            onChangeText={(v) => setDraft((d) => ({ ...d, url: v }))}
            style={{ backgroundColor: colors.bgPrimary, borderRadius: 6, padding: 8, color: colors.textPrimary }}
          />
          <TextInput
            testID="subIntervalInput"
            placeholder={t("subscriptions.interval")}
            placeholderTextColor={colors.textSecondary}
            keyboardType="number-pad"
            value={String(draft.interval)}
            onChangeText={(v) => setDraft((d) => ({ ...d, interval: Number(v) || DEFAULT_INTERVAL }))}
            style={{ backgroundColor: colors.bgPrimary, borderRadius: 6, padding: 8, color: colors.textPrimary }}
          />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: colors.textPrimary }}>{t("subscriptions.autoUpdate")}</Text>
            <Switch value={draft.auto_update} onValueChange={(v) => setDraft((d) => ({ ...d, auto_update: v }))} />
          </View>
          {formError ? <Text style={{ color: "#ef4444" }}>{formError}</Text> : null}
          <Pressable
            testID="subSubmit"
            onPress={() => void submit()}
            style={{ alignSelf: "flex-end", paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.accent, borderRadius: 8 }}
          >
            <Text style={{ color: "#fff" }}>{t("common.save")}</Text>
          </Pressable>
        </View>
      ) : null}
      <FlatList
        data={items}
        keyExtractor={(s) => String(s.id)}
        {...LIST_PERF_DEFAULT}
        ListEmptyComponent={<Text style={{ padding: 24, color: colors.textSecondary }}>{t("subscriptions.empty")}</Text>}
        renderItem={({ item }) => (
          <View style={{ marginHorizontal: 16, marginTop: 8, padding: 12, backgroundColor: colors.bgCard, borderRadius: 12 }}>
            <Text style={{ color: colors.textPrimary, fontWeight: "600" }}>{item.url}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
              {t("subscriptions.interval")}: {item.interval}s {"·"} {item.auto_update ? t("subscriptions.autoUpdate") : "—"}
            </Text>
            <View style={{ flexDirection: "row", marginTop: 8, gap: 16 }}>
              <Pressable testID={`subSync-${item.id}`} onPress={() => void sync(item.id)}>
                <Text style={{ color: colors.accent }}>{t("subscriptions.sync")}</Text>
              </Pressable>
              <Pressable testID={`subDelete-${item.id}`} onPress={() => remove(item)}>
                <Text style={{ color: "#ef4444" }}>{t("common.delete")}</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </View>
  );
}
