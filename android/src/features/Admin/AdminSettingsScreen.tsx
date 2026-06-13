// AdminSettingsScreen — schema-driven settings form, diff-only PUT, clamp + URL validation.
// AdminSettingsScreen — 由 schema 驱动的设置表单, 仅 diff 提交 + clamp + URL 校验.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";

import { createAdminAPI, type AdminAPI } from "@/api/admin";
import { type APIError, localizedMessage } from "@/api/apiError";
import { createAPIClient } from "@/api/client";
import { useTheme } from "@/designSystem/useTheme";
import { useAuthStore } from "@/store/authStore";
import { useServerStore } from "@/store/serverStore";

import {
  clampNumber,
  diffSettings,
  editableSettingsSchema,
  validatePublicBaseURL,
  type EditableSettingEntry,
} from "./settingsSchema";

/**
 * AdminSettingsScreenContextValue — admin binding for tests.
 * AdminSettingsScreenContextValue — 为测试提供 admin 绑定.
 */
export interface AdminSettingsScreenContextValue {
  admin: AdminAPI;
}

/**
 * AdminSettingsScreenContext — null-by-default; tests inject via Provider.
 * AdminSettingsScreenContext — 默认 null, 测试通过 Provider 注入.
 */
export const AdminSettingsScreenContext = createContext<AdminSettingsScreenContextValue | null>(null);

function useDefaultCtx(): AdminSettingsScreenContextValue | null {
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
 * AdminSettingsScreen — fetches all admin-allowed settings and exposes a schema-driven editor.
 * AdminSettingsScreen — 拉取全部允许的设置项并以 schema 驱动的编辑器展示.
 */
export function AdminSettingsScreen(){
  const injected = useContext(AdminSettingsScreenContext);
  const fallback = useDefaultCtx();
  const ctx = injected ?? fallback;
  const { colors } = useTheme();
  const { t } = useTranslation("admin");
  const [initial, setInitial] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!ctx) return;
    setLoading(true);
    try {
      const fetched = await ctx.admin.getSettings();
      setInitial(fetched);
      setValues(fetched);
      setErrors({});
    } finally {
      setLoading(false);
    }
  }, [ctx]);

  useEffect(() => { void load(); }, [load]);

  const setValue = (key: string, v: string) => setValues((curr) => ({ ...curr, [key]: v }));

  const save = async () => {
    const nextErrors: Record<string, string> = {};
    const clamped: Record<string, string> = { ...values };
    for (const entry of editableSettingsSchema) {
      // Skip keys the server did not return in `initial` — they're not editable in this view.
      // Iterating absent keys would synthesize defaults (e.g. clamp("") = min) and add them to
      // the diff even when untouched, sending spurious writes.
      // 跳过 server 未返回的 key, 防止 clamp("") 合成默认值进入 diff 触发误写.
      if (!(entry.key in initial)) continue;
      const v = (clamped[entry.key] ?? "").toString();
      if (entry.kind === "url") {
        if (validatePublicBaseURL(v)) nextErrors[entry.key] = t("settings.invalidUrl");
      } else if (entry.kind === "number") {
        const n = Number(v);
        if (!Number.isFinite(n) || v.trim() === "") {
          nextErrors[entry.key] = t("settings.outOfRange", { min: entry.min ?? "-", max: entry.max ?? "-" });
        } else {
          clamped[entry.key] = String(clampNumber(Math.trunc(n), entry.min, entry.max));
        }
      }
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    const patch = diffSettings(initial, clamped);
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    try {
      await ctx!.admin.updateSettings(patch);
      setInitial(clamped);
      setValues(clamped);
      setEditing(false);
    } catch (e) {
      setErrors({ __all__: localizedMessage(e as APIError) });
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bgPrimary }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bgPrimary }} contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", padding: 12, gap: 8 }}>
        {editing ? (
          <>
            <Pressable
              testID="settingsCancel"
              onPress={() => { setValues(initial); setErrors({}); setEditing(false); }}
              style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.bgCard, borderRadius: 8 }}
            >
              <Text style={{ color: colors.textPrimary }}>{t("settings.cancel")}</Text>
            </Pressable>
            <Pressable
              testID="settingsSave"
              onPress={() => void save()}
              style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.accent, borderRadius: 8 }}
            >
              <Text style={{ color: "#fff" }}>{t("settings.save")}</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            testID="settingsEdit"
            onPress={() => setEditing(true)}
            style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.accent, borderRadius: 8 }}
          >
            <Text style={{ color: "#fff" }}>{t("settings.edit")}</Text>
          </Pressable>
        )}
      </View>
      {errors.__all__ ? <Text style={{ color: "#ef4444", paddingHorizontal: 16 }}>{errors.__all__}</Text> : null}
      {editableSettingsSchema
        .filter((entry) => entry.key in initial)
        .map((entry) => (
          <SettingRow
            key={entry.key}
            entry={entry}
            value={values[entry.key] ?? ""}
            editing={editing}
            error={errors[entry.key]}
            onChange={(v) => setValue(entry.key, v)}
          />
        ))}
    </ScrollView>
  );
}

function SettingRow(props: {
  entry: EditableSettingEntry;
  value: string;
  editing: boolean;
  error?: string;
  onChange(v: string): void;
}){
  const { colors } = useTheme();
  const { t } = useTranslation("admin");
  const { entry, value, editing, error, onChange } = props;
  const label = t(`settings.labels.${entry.key}`);
  const testID = `settingsInput-${entry.key}`;

  let control: React.ReactElement;
  if (!editing) {
    control = <Text style={{ color: colors.textSecondary }}>{value || "—"}</Text>;
  } else if (entry.kind === "boolean") {
    control = (
      <Switch
        testID={testID}
        value={value === "true"}
        onValueChange={(v) => onChange(v ? "true" : "false")}
      />
    );
  } else if (entry.kind === "enum") {
    control = (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {(entry.options ?? []).map((o) => (
          <Pressable
            key={o.value}
            testID={`${testID}-${o.value}`}
            onPress={() => onChange(o.value)}
            style={{
              paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
              backgroundColor: value === o.value ? colors.accent : colors.bgPrimary,
            }}
          >
            <Text style={{ color: value === o.value ? "#fff" : colors.textPrimary }}>
              {t(`admin:${o.i18nKey}` as never)}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  } else {
    control = (
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        keyboardType={entry.kind === "number" ? "number-pad" : "default"}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ backgroundColor: colors.bgPrimary, borderRadius: 6, padding: 8, color: colors.textPrimary, minWidth: 160 }}
      />
    );
  }

  return (
    <View style={{ marginHorizontal: 16, marginTop: 8, padding: 12, backgroundColor: colors.bgCard, borderRadius: 12 }}>
      <Text style={{ color: colors.textPrimary, marginBottom: 6 }}>{label}</Text>
      {control}
      {error ? <Text style={{ color: "#ef4444", marginTop: 4 }}>{error}</Text> : null}
    </View>
  );
}
