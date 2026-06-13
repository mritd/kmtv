// ThemeProvider resolves the current colour scheme override into a palette + size pair.
// ThemeProvider 将当前主题覆盖解析为调色板与尺寸组合.

import { useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";

import { darkColors, lightColors, sizes } from "./theme";
import { ThemeContext, type ResolvedTheme } from "./useTheme";

/**
 * User-facing override that mirrors iOS Profile theme switch.
 * 与 iOS Profile 主题切换对齐的用户覆盖值.
 */
export type ThemeOverride = "system" | "light" | "dark";

/**
 * ThemeProvider supplies the resolved palette + sizes through React context.
 * ThemeProvider 通过 React context 提供解析后的调色板与尺寸.
 */
export function ThemeProvider({
  override,
  children,
}: {
  override: ThemeOverride;
  children: ReactNode;
}) {
  const systemScheme = useColorScheme();
  const resolved: ResolvedTheme = useMemo(() => {
    const mode = override === "system" ? (systemScheme === "dark" ? "dark" : "light") : override;
    const colors = mode === "dark" ? darkColors : lightColors;
    return { colors, sizes, mode };
  }, [override, systemScheme]);

  return <ThemeContext.Provider value={resolved}>{children}</ThemeContext.Provider>;
}
