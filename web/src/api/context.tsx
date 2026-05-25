/**
 * API React context — bridges the singleton APIClient into the component tree.
 * API React context — 将单例 APIClient 注入到组件树.
 *
 * Responsibilities / 职责:
 *   - Expose APIProvider (= React Context.Provider) for the top-level App — 向顶层 App 暴露 APIProvider
 *   - Expose useAPI hook so any component can reach the client — 通过 useAPI hook 让任意组件访问 client
 *   - Throw loudly when used outside a provider (prevents silent no-ops) — 在 Provider 外使用时快速报错
 *
 * Key exports / 主要导出:
 *   APIProvider, useAPI
 *
 * Callers / 调用方:
 *   App.tsx (wraps the tree with <APIProvider value={client}>)
 *   adminHooks.ts, viewerHooks.ts, auth/*, admin/*, account/*, viewer/* (consume via useAPI)
 */
import { createContext, useContext } from "react";

import type { APIClient } from "./client";

// APIContext holds the live APIClient instance; null means no provider is mounted.
// APIContext
// 持有当前 APIClient 实例; null 表示 Provider 未挂载.
const APIContext = createContext<APIClient | null>(null);

/**
 * APIProvider is the React Context Provider for the API client.
 * APIProvider
 * 是 API client 的 React Context Provider.
 *
 * Usage: `<APIProvider value={client}>{children}</APIProvider>`
 * Mount exactly once at the application root.
 * 仅在应用根部挂载一次.
 */
export const APIProvider = APIContext.Provider;

/**
 * useAPI returns the current APIClient from context.
 * useAPI
 * 从 context 中取出当前 APIClient.
 *
 * Throws if called outside an APIProvider — this is intentional to prevent
 * silent failures where a component would operate without an API client.
 * 在 APIProvider 外调用时抛出错误 — 防止组件在无 API client 的情况下静默失败.
 */
export function useAPI(): APIClient {
  const api = useContext(APIContext);
  if (!api) {
    throw new Error("APIProvider is missing");
  }
  return api;
}
