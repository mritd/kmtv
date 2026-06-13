// useTheme hook returns the resolved palette + size tokens for the current theme.
// useTheme hook 返回当前主题的调色板与尺寸 token.

import { createContext, useContext } from "react";

import { lightColors, sizes, type ColorPalette, type SizeTokens, type ThemeMode } from "./theme";

/**
 * Resolved theme exposed to consumers.
 * 暴露给消费者的解析后主题.
 */
export interface ResolvedTheme {
  colors: ColorPalette;
  sizes: SizeTokens;
  mode: ThemeMode;
}

/**
 * Default context value used outside any provider — falls back to light.
 * 在 provider 之外的默认值, 回退到 light.
 */
export const ThemeContext = createContext<ResolvedTheme>({
  colors: lightColors,
  sizes,
  mode: "light",
});

/**
 * Read the active theme. Components should call this rather than importing tokens directly.
 * 读取当前主题. 组件应通过该 hook 获取 token, 而非直接 import.
 */
export function useTheme(): ResolvedTheme {
  return useContext(ThemeContext);
}
