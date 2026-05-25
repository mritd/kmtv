/**
 * App — thin entry-point component and re-export surface for AppShell.
 * App — 轻量入口组件, 同时作为 AppShell 的重导出入口.
 *
 * Responsibilities / 职责:
 *   - Default export consumed by main.tsx to mount the application — 默认导出供 main.tsx 挂载应用
 *   - Named re-export of AppShell enables tests in App.test.tsx to import it directly — 命名重导出 AppShell 以便 App.test.tsx 直接引入
 *
 * Intentionally minimal — all provider composition lives in AppShell.
 * 故意保持最简 — 所有 Provider 组合逻辑均在 AppShell 中.
 *
 * Key exports / 主要导出:
 *   App (default), AppShell (named)
 *
 * Callers / 调用方:
 *   main.tsx — imports default App for rendering
 *   App.test.tsx — imports named AppShell for integration tests
 */

import { AppShell } from "@/app/AppShell";

// Named re-export so tests can do: import { AppShell } from "./App"
// without reaching into @/app internals and depending on the internal path.
// 命名重导出, 使测试可通过 import { AppShell } from "./App" 引入,
// 而无需直接依赖 @/app 的内部路径.
export { AppShell };

/**
 * App is the top-level component passed to createRoot in main.tsx.
 * App 是传递给 main.tsx 中 createRoot 的顶层组件.
 *
 * No props — production AppShell uses module-level defaults (tokenStore, queryClient).
 * 无 props — 生产环境的 AppShell 使用模块级默认值 (tokenStore、queryClient).
 */
export default function App() {
  return <AppShell />;
}
