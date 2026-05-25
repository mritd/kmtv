/**
 * Theme context provider and consumer hook for the KMTV React application.
 * Applies the active theme's CSS custom properties to document.documentElement synchronously
 * (via useLayoutEffect) to prevent a flash of the wrong theme on mount.
 *
 * KMTV React 应用的主题上下文 Provider 及消费 Hook.
 * 通过 useLayoutEffect 同步将活跃主题的 CSS 自定义属性应用到 document.documentElement,
 * 防止挂载时出现主题闪烁 (FOUC).
 *
 * Exports: ThemeProvider (component), useTheme (hook).
 *
 * Callers / 调用方:
 *   - AppLayout / App — wraps the entire application in <ThemeProvider>
 *   - account/ThemeSettings — calls useTheme() to read and change the preference
 *
 * DOM side-effects:
 *   - document.documentElement.dataset.theme   ← set to active theme id
 *   - document.documentElement.style           ← all CSS variables from applyThemeVariables()
 *
 * Store contract:
 *   - Defaults to createLocalThemeStore() (localStorage-backed, themeStorageKey="kmtv.theme").
 *   - Accept an injected ThemeStore for testing so tests never touch real localStorage.
 *
 * DOM 副作用:
 *   - document.documentElement.dataset.theme   ← 设置为当前主题 id
 *   - document.documentElement.style           ← applyThemeVariables() 返回的所有 CSS 变量
 *
 * Store 约定:
 *   - 默认使用 createLocalThemeStore() (localStorage 持久化, key="kmtv.theme").
 *   - 接受注入的 ThemeStore 以便测试时不触及真实 localStorage.
 */

import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";

import { createLocalThemeStore } from "./themeStore";
import {
  applyThemeVariables,
  defaultThemePreference,
  normalizeThemePreference,
  type ThemePreference,
  type ThemeStore,
} from "./themes";

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

/**
 * Value exposed by ThemeContext: the current preference and an updater function.
 * setTheme normalises the incoming value via normalizeThemePreference before storing.
 *
 * ThemeContext 暴露的值: 当前偏好和更新函数.
 * setTheme 在存储前通过 normalizeThemePreference 规范化传入值.
 */
interface ThemeContextValue {
  preference: ThemePreference;
  setTheme(preference: ThemePreference): void;
}

/**
 * React context holding the current theme preference and setter.
 * Initialised to null; useTheme provides a safe default when no provider is present.
 *
 * 持有当前主题偏好和设置函数的 React Context.
 * 初始为 null; useTheme 在没有 Provider 时提供安全的默认值.
 */
const ThemeContext = createContext<ThemeContextValue | null>(null);

// ---------------------------------------------------------------------------
// ThemeProvider component
// ---------------------------------------------------------------------------

/**
 * Root provider for the theme system.  Mount once near the application root.
 *
 * Props:
 *   - children — the React subtree to theme.
 *   - store    — optional ThemeStore; defaults to createLocalThemeStore() (localStorage-backed).
 *                Inject an in-memory store for tests to avoid touching window.localStorage.
 *
 * 主题系统的根 Provider, 在应用根节点附近挂载一次.
 *
 * Props:
 *   - children — 需要主题化的 React 子树.
 *   - store    — 可选 ThemeStore; 默认使用 createLocalThemeStore() (localStorage 持久化).
 *                测试时注入内存 store 以避免触及 window.localStorage.
 */
export function ThemeProvider({ children, store = createLocalThemeStore() }: { children: ReactNode; store?: ThemeStore }): React.JSX.Element {
  // Lazy initializer reads from the store once; subsequent updates come from setPreference.
  // 惰性初始化从 store 读取一次; 后续更新通过 setPreference 触发.
  const [preference, setPreference] = useState<ThemePreference>(() => store.get());

  // useLayoutEffect instead of useEffect: CSS variables must be on the DOM before the browser
  // paints, otherwise the page flashes with default (un-themed) styles on first render.
  // 使用 useLayoutEffect 而非 useEffect: CSS 变量必须在浏览器绘制前写入 DOM,
  // 否则首次渲染时页面会以默认 (未主题化) 样式闪烁.
  useLayoutEffect(() => {
    const root = document.documentElement;
    // Re-normalise in the effect to guard against any state value that bypassed setTheme.
    // 在 effect 中再次规范化, 防御任何绕过 setTheme 的状态值.
    const normalized = normalizeThemePreference(preference);
    root.dataset.theme = normalized.id;
    const variables = applyThemeVariables(normalized);
    for (const [name, value] of Object.entries(variables)) {
      root.style.setProperty(name, value);
    }
  }, [preference]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      setTheme(next) {
        const normalized = normalizeThemePreference(next);
        // Persist first so a re-render triggered by setPreference reads the already-written value.
        // 先持久化再触发重渲染, 确保重渲染时已写入的值可被读取.
        store.set(normalized);
        setPreference(normalized);
      },
    }),
    [preference, store],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// ---------------------------------------------------------------------------
// useTheme consumer hook
// ---------------------------------------------------------------------------

/**
 * Returns the active ThemeContextValue (preference + setTheme).
 * Safe to call outside a ThemeProvider — returns the default nocturne preference
 * and a no-op setTheme so orphaned components do not crash.
 *
 * 返回活跃的 ThemeContextValue (preference + setTheme).
 * 可在 ThemeProvider 外部安全调用 — 返回默认 nocturne 偏好和无操作的 setTheme,
 * 确保孤立组件不会崩溃.
 */
export function useTheme(): ThemeContextValue {
  // useContext returns null when no ThemeProvider is present.
  // The fallback keeps consumers functional without crashing.
  // useContext 在无 ThemeProvider 时返回 null; 后备值确保消费者正常工作.
  return useContext(ThemeContext) ?? { preference: defaultThemePreference, setTheme: () => undefined };
}
