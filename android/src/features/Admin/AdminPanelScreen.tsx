// AdminPanelScreen — menu of the four admin sub-areas. Defense-in-depth gates non-admin.
// AdminPanelScreen — 四个管理子页面的入口菜单, 非管理员被拦截.

import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";

import { useTheme } from "@/designSystem/useTheme";
import type { ProfileStackParamList } from "@/navigation/types";
import { useAuthStore } from "@/store/authStore";

type RowKey = Exclude<keyof ProfileStackParamList, "ProfileRoot" | "AdminPanel">;

/**
 * AdminPanelScreen — root menu inside ProfileStack. Each row pushes one sub-screen.
 * AdminPanelScreen — ProfileStack 内的根菜单, 每行 push 一个子页面.
 */
export function AdminPanelScreen(){
  const { t } = useTranslation("admin");
  const { colors } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const role = useAuthStore((s) => s.user?.role);

  if (role !== "admin") {
    return (
      <View
        testID="adminForbidden"
        style={{ flex: 1, padding: 24, alignItems: "center", justifyContent: "center", backgroundColor: colors.bgPrimary }}
      >
        <Text style={{ color: colors.textSecondary }}>{t("common.forbidden")}</Text>
      </View>
    );
  }

  const rows: Array<{ key: RowKey; label: string; testID: string }> = [
    { key: "AdminSources", label: t("panel.sources"), testID: "adminPanel-sources" },
    { key: "AdminSubscriptions", label: t("panel.subscriptions"), testID: "adminPanel-subscriptions" },
    { key: "AdminUsers", label: t("panel.users"), testID: "adminPanel-users" },
    { key: "AdminSettings", label: t("panel.settings"), testID: "adminPanel-settings" },
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bgPrimary }} contentContainerStyle={{ padding: 16, gap: 8 }}>
      {rows.map((r) => (
        <Pressable
          key={r.key}
          testID={r.testID}
          accessibilityRole="button"
          onPress={() => navigation.navigate(r.key)}
          style={{
            padding: 16,
            borderRadius: 12,
            backgroundColor: colors.bgCard,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text style={{ color: colors.textPrimary, fontSize: 17 }}>{r.label}</Text>
          <Text style={{ color: colors.textSecondary }}>›</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
