// Toast: provider + useToast() + <ToastHost />. Auto-dismisses after 3 s; later show() cancels the prior timer.
// Toast: provider + useToast() + <ToastHost />. 3 秒自动消失; 后续 show() 会取消之前的计时器.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useTheme } from "./useTheme";

interface ToastAPI {
  show: (message: string) => void;
}

const Ctx = createContext<ToastAPI | null>(null);
const InternalCtx = createContext<string | null>(null);

const AUTO_DISMISS_MS = 3000;

/**
 * ToastProvider owns the current toast message + auto-dismiss timer.
 * ToastProvider 持有当前 toast 消息与自动消失计时器.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((m: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setMsg(m);
    timerRef.current = setTimeout(() => { setMsg(null); timerRef.current = null; }, AUTO_DISMISS_MS);
  }, []);

  // Clear the pending timer on unmount so the provider doesn't setState after teardown.
  // 卸载时清理待触发的计时器, 避免在 provider 卸载后还调用 setState.
  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const api = useMemo<ToastAPI>(() => ({ show }), [show]);

  return (
    <Ctx.Provider value={api}>
      <InternalCtx.Provider value={msg}>{children}</InternalCtx.Provider>
    </Ctx.Provider>
  );
}

/**
 * useToast surfaces the show() API to feature modules; throws if used outside ToastProvider.
 * useToast 向功能模块暴露 show() API; 若在 ToastProvider 外使用则抛错.
 */
export function useToast(): ToastAPI {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast must be used inside <ToastProvider>");
  return v;
}

/**
 * ToastHost renders the visible toast bubble; mount once near the navigation root.
 * ToastHost 渲染可见的 toast 气泡, 在导航根附近挂载一次即可.
 */
export function ToastHost() {
  const { colors } = useTheme();
  const msg = useContext(InternalCtx);
  if (!msg) return null;
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View style={[styles.bubble, { backgroundColor: "rgba(220, 50, 47, 0.92)" }]}>
        <Text style={[styles.text, { color: "white" }]} accessibilityLiveRegion="polite">
          {msg}
        </Text>
        {/* Theme accent kept as a tinted accent stripe for future variants. */}
        {/* 主题强调色作为色带留待后续变体扩展. */}
        <View style={{ width: 0, height: 0, backgroundColor: colors.accent }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, top: 60, alignItems: "center" },
  bubble: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, maxWidth: "90%" },
  text: { fontSize: 15, fontWeight: "500" },
});
