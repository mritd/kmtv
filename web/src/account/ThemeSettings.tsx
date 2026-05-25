/**
 * ThemeSettings — theme selection and custom palette editor panel shown on the AccountPage.
 * ThemeSettings — 在 AccountPage 显示的主题选择和自定义调色板编辑面板.
 *
 * Responsibilities / 职责:
 *   - Render a button grid for each built-in theme with name, description, and three color swatches.
 *     渲染每个内置主题的按钮网格, 包含名称、描述和三个色板色块.
 *   - Render a "custom" theme button that activates the inline color picker form.
 *     渲染 "自定义" 主题按钮, 激活内联色彩选择器表单.
 *   - When the custom theme is active, show four <input type="color"> fields and a reset button.
 *     当自定义主题激活时, 显示四个 <input type="color"> 字段和重置按钮.
 *   - Delegate all reads and writes to useTheme() from ThemeProvider.
 *     所有读取和写入委托给来自 ThemeProvider 的 useTheme().
 *
 * Key exports / 主要导出:
 *   ThemeSettings
 *
 * Callers / 调用方:
 *   account/AccountPage.tsx (always rendered, regardless of auth state)
 *
 * TIER 4 LOCKED — localStorage key for theme preference is managed by themeStore.
 * Do not change the theme IDs used here; they map to CSS variables loaded by ThemeProvider.
 * Tier 4 锁定 — 主题偏好的 localStorage key 由 themeStore 管理.
 * 不得更改此处使用的主题 ID; 它们映射到 ThemeProvider 加载的 CSS 变量.
 */
import { useTranslation } from "react-i18next";

import { builtInThemes, type CustomTheme, type ThemePreference } from "@/theme/themes";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/shared/ui/Button";

// defaultCustomPalette is the starting point applied when the user first switches to "custom".
// It uses a dark-purple palette to avoid a jarring all-white or all-black flash.
// defaultCustomPalette 是用户首次切换到 "自定义" 时应用的初始值.
// 使用深紫色调以避免出现刺眼的全白或全黑闪烁.
const defaultCustomPalette: CustomTheme = { background: "#0b0d11", surface: "#151821", accent: "#8b5cf6", text: "#f8fafc" };

// defaultCustom is the ThemePreference passed to setTheme() when the custom button is clicked.
// defaultCustom 是点击自定义按钮时传给 setTheme() 的 ThemePreference.
const defaultCustom: ThemePreference = {
  id: "custom",
  custom: defaultCustomPalette,
};

/**
 * ThemeSettings renders the theme selector panel.
 * ThemeSettings 渲染主题选择器面板.
 *
 * `themeLabel` and `themeDescription` fall back to built-in values when the i18n key is missing,
 * so new themes added to the themes array do not require a translation update to render correctly.
 * `themeLabel` 和 `themeDescription` 在 i18n key 缺失时回退到内置值,
 * 因此向主题数组添加新主题时无需同步更新翻译.
 */
export function ThemeSettings() {
  const { t } = useTranslation("account");
  const { preference, setTheme } = useTheme();
  const customTheme = preference.id === "custom" ? preference.custom : defaultCustomPalette;

  // themeLabel / themeDescription look up the i18n key and fall back to the built-in string.
  // The `as never` cast silences the TypeScript exhaustive-key check because theme IDs are dynamic.
  // themeLabel / themeDescription 查找 i18n key, 缺失时回退到内置字符串.
  // `as never` 类型转换消除 TypeScript 穷举 key 检查, 因为主题 ID 是动态的.
  function themeLabel(id: string, fallback: string): string {
    return t(`theme.themes.${id}.label` as never, { defaultValue: fallback });
  }
  function themeDescription(id: string, fallback: string): string {
    return t(`theme.themes.${id}.description` as never, { defaultValue: fallback });
  }

  return (
    <section className="settings-panel">
      <div className="heading-block">
        <h2>{t("theme.sectionTitle")}</h2>
        <p className="muted">{t("theme.description")}</p>
      </div>
      <div className="theme-choice-grid">
        {builtInThemes.map((theme) => (
          <button
            className={preference.id === theme.id ? "theme-choice active" : "theme-choice"}
            key={theme.id}
            type="button"
            onClick={() => setTheme({ id: theme.id })}
            aria-label={themeLabel(theme.id, theme.label)}
          >
            <div>
              <strong>{themeLabel(theme.id, theme.label)}</strong>
              <span>{themeDescription(theme.id, theme.description)}</span>
            </div>
            <div className="theme-swatches" aria-hidden="true">
              <i style={{ background: theme.variables["--bg"] }} />
              <i style={{ background: theme.variables["--surface"] }} />
              <i style={{ background: theme.variables["--accent"] }} />
            </div>
          </button>
        ))}
        <button
          className={preference.id === "custom" ? "theme-choice active" : "theme-choice"}
          type="button"
          onClick={() => setTheme(defaultCustom)}
          aria-label={t("theme.customPaletteTitle")}
        >
          <div>
            <strong>{t("theme.customPaletteTitle")}</strong>
            <span>{t("theme.customPaletteDescription")}</span>
          </div>
          <div className="theme-swatches" aria-hidden="true">
            <i style={{ background: customTheme.background }} />
            <i style={{ background: customTheme.surface }} />
            <i style={{ background: customTheme.accent }} />
          </div>
        </button>
      </div>
      {preference.id === "custom" ? (
        <div className="custom-palette-form">
          {(["background", "surface", "accent", "text"] as const).map((key) => (
            <label key={key}>
              {key}
              <input type="color" value={preference.custom[key]} onChange={(event) => setTheme({ id: "custom", custom: { ...preference.custom, [key]: event.target.value } })} />
            </label>
          ))}
          <Button type="button" variant="ghost" onClick={() => setTheme({ id: "nocturne" })}>
            {t("theme.resetButton")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
