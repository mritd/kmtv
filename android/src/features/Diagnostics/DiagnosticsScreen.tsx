// DiagnosticsScreen — view recent uncaught + console errors captured by installGlobalErrorHandler.
// DiagnosticsScreen — 查看由 installGlobalErrorHandler 捕获的近期未捕获 + console 错误.

import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { clearErrorLog, loadErrorEntries, type ErrorEntry } from "@/diagnostics/errorLog";
import { LIST_PERF_DEFAULT } from "@/designSystem/listPerf";
import { useTheme } from "@/designSystem/useTheme";

/**
 * DiagnosticsScreen — list of recent error entries with a clear button.
 * DiagnosticsScreen — 近期错误条目列表 + 清空按钮.
 */
export function DiagnosticsScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation("diagnostics");
  const [entries, setEntries] = useState<ErrorEntry[]>(() => loadErrorEntries());

  const onClear = useCallback(() => {
    clearErrorLog();
    setEntries([]);
  }, []);

  if (entries.length === 0) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.bgPrimary }]}>
        <Text style={{ color: colors.textSecondary }}>{t("empty")}</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
      <View style={styles.header}>
        <Pressable
          testID="diagnosticsClear"
          onPress={onClear}
          style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.bgCard, borderRadius: 8 }}
        >
          <Text style={{ color: colors.textPrimary }}>{t("clear")}</Text>
        </Pressable>
      </View>
      <FlatList
        data={entries}
        keyExtractor={(e, i) => `${e.ts}-${i}`}
        {...LIST_PERF_DEFAULT}
        renderItem={({ item }) => (
          <View style={[styles.row, { backgroundColor: colors.bgCard }]}>
            <Text style={{ color: colors.textSecondary, fontSize: 11 }}>
              [{t(`source.${item.source}`)}] {new Date(item.ts).toISOString()}
            </Text>
            <Text style={{ color: colors.textPrimary, marginTop: 4 }} selectable>
              {item.message}
            </Text>
            {item.stack ? (
              <Text
                style={{ color: colors.textSecondary, marginTop: 4, fontSize: 11 }}
                selectable
                numberOfLines={6}
              >
                {item.stack}
              </Text>
            ) : null}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", justifyContent: "flex-end", padding: 12 },
  row: { marginHorizontal: 16, marginTop: 8, padding: 12, borderRadius: 12 },
});
