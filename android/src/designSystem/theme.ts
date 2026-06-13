// English. 中文.
// Theme tokens mirroring apple/Shared/DesignSystem/Theme.swift.
// 镜像 apple/Shared/DesignSystem/Theme.swift 的主题 token.

/**
 * Strong palette shape used by both light and dark variants.
 * 浅色与深色变体共用的调色板形状.
 */
export interface ColorPalette {
  bgPrimary: string;
  bgSecondary: string;
  bgCard: string;
  accent: string;
  textPrimary: string;
  textSecondary: string;
  ratingBadgeBg: string;
}

/**
 * Layout size tokens shared across themes.
 * 跨主题共享的尺寸 token.
 */
export interface SizeTokens {
  cardWidth: number;
  heroHeight: number;
  heroHeightTablet: number;
  radius: { sm: number; md: number; lg: number; xl: number; hero: number };
}

/**
 * Light palette mirrors Theme.swift light variants.
 * 浅色调色板与 Theme.swift light 分支保持一致.
 */
export const lightColors: ColorPalette = {
  bgPrimary: "rgb(245, 245, 247)",
  bgSecondary: "rgb(235, 235, 239)",
  bgCard: "rgb(255, 255, 255)",
  accent: "rgb(74, 138, 245)",
  textPrimary: "rgb(28, 28, 30)",
  textSecondary: "rgb(107, 107, 111)",
  ratingBadgeBg: "rgba(0, 0, 0, 0.7)",
};

/**
 * Dark palette mirrors Theme.swift dark variants.
 * 深色调色板与 Theme.swift dark 分支保持一致.
 */
export const darkColors: ColorPalette = {
  bgPrimary: "rgb(10, 10, 10)",
  bgSecondary: "rgb(20, 20, 24)",
  bgCard: "rgb(30, 30, 38)",
  accent: "rgb(108, 159, 255)",
  textPrimary: "rgb(232, 232, 240)",
  textSecondary: "rgb(136, 136, 136)",
  ratingBadgeBg: "rgba(0, 0, 0, 0.7)",
};

/**
 * Layout size tokens. heroHeightTablet kicks in at width >= 600 dp per the design spec.
 * 尺寸 token. heroHeightTablet 在宽度 >= 600 dp 时生效, 与设计 spec 对齐.
 */
export const sizes: SizeTokens = {
  cardWidth: 110,
  heroHeight: 240,
  heroHeightTablet: 320,
  radius: { sm: 4, md: 6, lg: 8, xl: 12, hero: 16 },
};

/**
 * Theme mode flag used by the ThemeProvider override resolution.
 * ThemeProvider 解析覆盖时使用的主题模式标记.
 */
export type ThemeMode = "light" | "dark";
