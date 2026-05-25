/**
 * Theme model — built-in theme definitions, CSS variable maps, and normalisation helpers.
 * Exports: BuiltInThemeID, ThemePreference, CustomTheme, ThemeDefinition, ThemeVariables,
 *          ThemeStore, builtInThemes, defaultThemePreference,
 *          normalizeThemePreference, applyThemeVariables, createMemoryThemeStore.
 *
 * 主题模型 — 内置主题定义, CSS 变量映射及规范化辅助函数.
 * 导出: BuiltInThemeID, ThemePreference, CustomTheme, ThemeDefinition, ThemeVariables,
 *       ThemeStore, builtInThemes, defaultThemePreference,
 *       normalizeThemePreference, applyThemeVariables, createMemoryThemeStore.
 *
 * Callers / 调用方:
 *   - ThemeProvider.tsx  — applies variables to document.documentElement
 *   - themeStore.ts      — persists preferences via normalizeThemePreference
 *   - account/ThemeSettings.tsx — reads builtInThemes for the UI picker
 *
 * IMPORTANT: The three built-in theme identifiers (graphite / nocturne / tech-purple) are
 * Tier-4 locked — do not rename them.  They must match the i18n key suffixes and the
 * data-theme attribute values used by global CSS.
 *
 * 重要: 三个内置主题标识符 (graphite / nocturne / tech-purple) 为 Tier-4 锁定 —
 * 不得重命名. 它们必须与 i18n key 后缀及全局 CSS 使用的 data-theme 属性值保持一致.
 */

// ---------------------------------------------------------------------------
// Theme IDs & discriminated-union preference type
// ---------------------------------------------------------------------------

/** Identifier for one of the three built-in cinema themes. / 三个内置影院主题之一的标识符. */
export type BuiltInThemeID = "graphite" | "nocturne" | "tech-purple";
/**
 * Discriminated union representing either a built-in theme or a fully-specified custom theme.
 * The "custom" branch requires all four hex color fields to be valid 6-digit hex strings.
 *
 * 区分联合类型, 表示内置主题或完整自定义主题.
 * "custom" 分支要求四个颜色字段均为有效的 6 位十六进制字符串.
 */
export type ThemePreference = { id: BuiltInThemeID } | { id: "custom"; custom: CustomTheme };

/**
 * The four seed colors required for a custom theme.  All other semantic variables
 * (muted text, borders, ambient glow) are derived from these four via color-mix().
 *
 * 自定义主题所需的四个基础颜色. 其他语义变量 (柔和文字, 边框, 环境光辉) 均通过 color-mix() 从这四个值派生.
 */
export interface CustomTheme {
  background: string;
  surface: string;
  accent: string;
  text: string;
}

/**
 * A single built-in theme record: stable ID, human-readable label, short description,
 * and the full set of CSS custom properties to apply to :root.
 *
 * 单个内置主题记录: 稳定 ID, 可读标签, 简短描述, 以及应用到 :root 的全套 CSS 自定义属性.
 */
export interface ThemeDefinition {
  id: BuiltInThemeID;
  label: string;
  description: string;
  variables: ThemeVariables;
}

/**
 * A map of CSS custom property names (e.g. "--bg") to their resolved string values.
 * The template literal constraint enforces the CSS double-dash convention.
 *
 * CSS 自定义属性名 (例如 "--bg") 到其字符串值的映射.
 * 模板字面类型约束强制执行 CSS 双连字符规范.
 */
export type ThemeVariables = Record<`--${string}`, string>;

// ---------------------------------------------------------------------------
// Built-in theme catalogue
// ---------------------------------------------------------------------------

/**
 * Ordered list of built-in themes displayed in the theme picker.
 * Index 0 is the default (nocturne).  Do not reorder without updating
 * the applyThemeVariables fallback which references builtInThemes[0].
 *
 * 内置主题的有序列表, 在主题选择器中展示.
 * 索引 0 为默认值 (nocturne). 修改顺序前需同步更新 applyThemeVariables 中引用 builtInThemes[0] 的后备逻辑.
 *
 * Chinese product names: 夜曲蓝 (nocturne) / 石墨黑 (graphite) / 科技紫 (tech-purple).
 * 中文产品名称: 夜曲蓝 / 石墨黑 / 科技紫.
 */
export const builtInThemes: ThemeDefinition[] = [
  {
    id: "nocturne",
    label: "Nocturne Blue",
    description: "Dark blue-black with restrained mist-blue accents.",
    variables: {
      "--bg": "#05070d",
      "--bg-elevated": "#080d18",
      "--surface": "#101827",
      "--surface-strong": "#17233a",
      "--text": "#f8fafc",
      "--text-muted": "#b6c3d5",
      "--text-faint": "#7c8aa0",
      "--accent": "#bfdbfe",
      "--accent-text": "#0b1220",
      "--ambient": "rgba(96, 165, 250, 0.2)",
      "--border": "rgba(191, 219, 254, 0.13)",
      "--border-strong": "rgba(191, 219, 254, 0.24)",
      "--danger": "#fb7185",
      "--success": "#86efac",
    },
  },
  {
    id: "graphite",
    label: "Graphite Cinema",
    description: "Cold white and graphite black. The default quiet cinema theme.",
    variables: {
      "--bg": "#060708",
      "--bg-elevated": "#0b0d11",
      "--surface": "#141821",
      "--surface-strong": "#1c2230",
      "--text": "#f8fafc",
      "--text-muted": "#a7b0bd",
      "--text-faint": "#737b88",
      "--accent": "#f8fafc",
      "--accent-text": "#0f172a",
      "--ambient": "rgba(203, 213, 225, 0.18)",
      "--border": "rgba(248, 250, 252, 0.12)",
      "--border-strong": "rgba(248, 250, 252, 0.2)",
      "--danger": "#fb7185",
      "--success": "#86efac",
    },
  },
  {
    id: "tech-purple",
    label: "Tech Purple",
    description: "Deep-space dark with restrained technology-purple accents.",
    variables: {
      "--bg": "#070611",
      "--bg-elevated": "#0d0a1c",
      "--surface": "#121024",
      "--surface-strong": "#1b1734",
      "--text": "#f8fafc",
      "--text-muted": "#c5bdd8",
      "--text-faint": "#8a7fa2",
      "--accent": "#ddd6fe",
      "--accent-text": "#17102d",
      "--ambient": "rgba(168, 85, 247, 0.2)",
      "--border": "rgba(221, 214, 254, 0.13)",
      "--border-strong": "rgba(221, 214, 254, 0.24)",
      "--danger": "#fb7185",
      "--success": "#86efac",
    },
  },
];

// ---------------------------------------------------------------------------
// Default preference & validation helpers
// ---------------------------------------------------------------------------

/**
 * The application default: Nocturne Blue (夜曲蓝).
 * Used as the fallback when no valid preference is stored or when normalisation fails.
 *
 * 应用默认主题: 夜曲蓝 (Nocturne Blue).
 * 当无有效偏好或规范化失败时用作后备.
 */
export const defaultThemePreference: ThemePreference = { id: "nocturne" };

/**
 * Returns true iff value is a non-empty 6-digit hex color string (e.g. "#1a2b3c").
 * Used to validate the four custom theme color fields before accepting a custom preference.
 *
 * 当且仅当 value 为非空 6 位十六进制颜色字符串 (如 "#1a2b3c") 时返回 true.
 * 用于在接受自定义 preference 前校验四个自定义颜色字段.
 */
function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

/**
 * Parses and validates an untrusted value (typically from JSON.parse) into a valid ThemePreference.
 * Unknown IDs, malformed custom themes, and non-object inputs all fall back to defaultThemePreference.
 *
 * 将不受信任的值 (通常来自 JSON.parse) 解析并校验为合法的 ThemePreference.
 * 未知 ID, 不完整的自定义主题及非对象输入均回退为 defaultThemePreference.
 */
export function normalizeThemePreference(value: unknown): ThemePreference {
  if (!value || typeof value !== "object") {
    return defaultThemePreference;
  }

  const candidate = value as Partial<ThemePreference> & { custom?: Partial<CustomTheme> };
  if (candidate.id === "custom" && candidate.custom) {
    const { background, surface, accent, text } = candidate.custom;
    if ([background, surface, accent, text].every(isHexColor)) {
      return { id: "custom", custom: { background, surface, accent, text } };
    }
  }

  if (candidate.id === "graphite" || candidate.id === "nocturne" || candidate.id === "tech-purple") {
    return { id: candidate.id };
  }

  return defaultThemePreference;
}

// ---------------------------------------------------------------------------
// CSS variable application
// ---------------------------------------------------------------------------

/**
 * Resolves a validated ThemePreference to the full map of CSS custom properties.
 * For built-in themes, returns the pre-authored variables object directly.
 * For custom themes, derives muted/faint text, ambient glow, and borders via color-mix().
 * Falls back to builtInThemes[0] (nocturne) if the built-in ID is somehow missing from the list
 * (defensive guard — should not happen with valid ThemePreference).
 *
 * 将已校验的 ThemePreference 解析为完整 CSS 自定义属性映射.
 * 对内置主题直接返回预定义变量对象; 对自定义主题通过 color-mix() 派生柔和文字/环境光辉/边框.
 * 若内置 ID 在列表中找不到则回退到 builtInThemes[0] (nocturne) — 防御性保护, 正常路径不触发.
 */
export function applyThemeVariables(preference: ThemePreference): ThemeVariables {
  if (preference.id === "custom") {
    return {
      "--bg": preference.custom.background,
      "--bg-elevated": preference.custom.background,
      "--surface": preference.custom.surface,
      "--surface-strong": preference.custom.surface,
      "--text": preference.custom.text,
      "--text-muted": "color-mix(in srgb, var(--text) 72%, transparent)",
      "--text-faint": "color-mix(in srgb, var(--text) 48%, transparent)",
      "--accent": preference.custom.accent,
      "--accent-text": preference.custom.background,
      "--ambient": "color-mix(in srgb, var(--accent) 20%, transparent)",
      "--border": "color-mix(in srgb, var(--text) 13%, transparent)",
      "--border-strong": "color-mix(in srgb, var(--text) 24%, transparent)",
      "--danger": "#fb7185",
      "--success": "#86efac",
    };
  }

  return builtInThemes.find((theme) => theme.id === preference.id)?.variables ?? builtInThemes[0].variables;
}

// ---------------------------------------------------------------------------
// ThemeStore interface & in-memory implementation
// ---------------------------------------------------------------------------

/**
 * Minimal storage abstraction used by ThemeProvider.
 * Production: createLocalThemeStore (localStorage-backed) from themeStore.ts.
 * Testing: createMemoryThemeStore (in-memory) defined below.
 *
 * ThemeProvider 使用的最小存储抽象接口.
 * 生产: themeStore.ts 中的 createLocalThemeStore (基于 localStorage).
 * 测试: 下方定义的 createMemoryThemeStore (内存实现).
 */
export interface ThemeStore {
  get(): ThemePreference;
  set(preference: ThemePreference): void;
}

/**
 * Creates an in-memory ThemeStore for testing and storybook use.
 * Always normalizes via normalizeThemePreference so the store never holds an invalid preference.
 *
 * 创建用于测试和 Storybook 的内存 ThemeStore.
 * 始终通过 normalizeThemePreference 规范化, 确保 store 不持有无效 preference.
 */
export function createMemoryThemeStore(initial: ThemePreference = defaultThemePreference): ThemeStore {
  let current = normalizeThemePreference(initial);

  return {
    get: () => current,
    set: (preference) => {
      current = normalizeThemePreference(preference);
    },
  };
}
