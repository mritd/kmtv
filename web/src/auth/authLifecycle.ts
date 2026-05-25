/**
 * authLifecycle — identity-transition orchestration for the auth subsystem.
 * authLifecycle — 认证子系统的身份切换编排.
 *
 * Responsibilities / 职责:
 *   - Tear down user-scoped React Query caches on every identity change — 每次身份变更时清理用户作用域查询缓存
 *   - Reset user-scoped Zustand stores in a guaranteed order — 按固定顺序重置用户作用域 Zustand store
 *   - Preserve device-level preferences across user switches (theme, language) — 跨用户切换保留设备级偏好
 *   - Expose a registry so store modules self-register without coupling to this file — 暴露注册表让 store 模块自注册, 不耦合此文件
 *
 * Key exports / 主要导出:
 *   ResetCallbacks, ResetOptions, registerUserScopedReset, resetUserScopedState
 *
 * Callers / 调用方:
 *   AuthContext.tsx (calls resetUserScopedState on identity change)
 *   store/* modules (call registerUserScopedReset at import time)
 *
 * Ordering invariant: cancelQueries → clear → userScoped resets → (devicePreferences skipped).
 * The cancel-before-clear guard prevents settled in-flight responses from repopulating a cleared cache.
 * 顺序不变量: cancelQueries → clear → 用户作用域重置 → (设备偏好跳过).
 * 先 cancel 再 clear 防止已发出的响应在 clear 后回填缓存.
 */

import type { QueryClient } from "@tanstack/react-query";

import type { AuthClearReason } from "@/api/tokenStore";

/**
 * ResetCallbacks holds two segregated lists of reset functions.
 * ResetCallbacks 持有两类重置函数列表.
 *
 * Separation ensures theme / language never reset during a user switch —
 * only on explicit "reset preferences" actions (not yet implemented).
 * 分离确保主题/语言在用户切换时不被重置 — 只在用户明确"重置偏好"时触发 (尚未实现).
 */
export interface ResetCallbacks {
  // userScoped resets are invoked on every identity transition (login, logout, 401, expired, external).
  // 用户作用域重置在每次身份变更时调用.
  userScoped: Array<() => void>;
  // devicePreferences are preserved across users (theme, language).
  // 设备级偏好跨用户保留 (主题, 语言).
  devicePreferences: Array<() => void>;
}

/**
 * ResetOptions parameterises a single resetUserScopedState call.
 * ResetOptions 参数化单次 resetUserScopedState 调用.
 *
 * `reason` carries the AuthClearReason from the tokenStore so future implementations
 * can tailor behaviour per reason (e.g. show a "session expired" toast).
 * reason 携带 tokenStore 的 AuthClearReason, 供未来实现按原因定制行为 (如显示"会话过期"提示).
 *
 * `stores` overrides the default module-level registry — pass this in tests to avoid
 * polluting the global callback list.
 * stores 覆盖默认的模块级注册表 — 测试中传入以避免污染全局回调列表.
 */
export interface ResetOptions {
  reason: AuthClearReason;
  stores?: ResetCallbacks;
}

// Default callback registry, populated by store modules via registerUserScopedReset.
// devicePreferences is not auto-populated; callers pass it explicitly via ResetOptions.stores when needed.
// 默认回调注册表, 由各 store 模块通过 registerUserScopedReset 填充.
// devicePreferences 不自动注册; 调用方在需要时通过 ResetOptions.stores 显式传入.
const defaultCallbacks: ResetCallbacks = { userScoped: [], devicePreferences: [] };

/**
 * registerUserScopedReset registers a reset function invoked on every user-identity transition.
 * registerUserScopedReset 注册每次用户身份切换时调用的重置函数.
 *
 * Returns an unregister function — call it in module cleanup or tests to avoid stale callbacks.
 * 返回注销函数 — 在模块清理或测试中调用以避免陈旧回调.
 *
 * Registrations persist for the lifetime of the module. Store modules typically call this
 * at the top level so the callback is always present by the time AuthContext mounts.
 * 注册在模块生命周期内持久化. store 模块通常在顶层调用, 确保 AuthContext 挂载时回调已就绪.
 */
export function registerUserScopedReset(fn: () => void): () => void {
  defaultCallbacks.userScoped.push(fn);
  return () => {
    const idx = defaultCallbacks.userScoped.indexOf(fn);
    if (idx !== -1) defaultCallbacks.userScoped.splice(idx, 1);
  };
}

/**
 * resetUserScopedState tears down user-scoped state in a guaranteed order.
 * resetUserScopedState 按固定顺序清理用户作用域状态.
 *
 * Called by AuthContext on every user-identity change (login, logout, 401, password-change eviction).
 * AuthContext 在每次用户身份变更时调用 (登录、退出、401、密码变更导致的 token 注销).
 *
 * Await this call; the cancelQueries step is async and must resolve before cache clear.
 * 必须 await 此调用; cancelQueries 步骤是异步的, 必须在 clear 前 resolve.
 */
export async function resetUserScopedState(queryClient: QueryClient, options: ResetOptions): Promise<void> {
  const callbacks = options.stores ?? defaultCallbacks;
  // Step 1:
  // cancel in-flight queries before clearing, so settled responses cannot repopulate the cache.
  // 先取消进行中的查询再清空, 防止已发出的响应回填缓存.
  await queryClient.cancelQueries();
  // Step 2:
  // drop every cached server response.
  // 清除所有缓存的服务端响应.
  queryClient.clear();
  // Step 3:
  // reset every user-scoped Zustand store.
  // 重置每个用户作用域 store.
  for (const reset of callbacks.userScoped) reset();
  // Step 4 (implicit): devicePreferences callbacks are intentionally NOT invoked.
  // devicePreferences 回调有意不调用 — 主题和语言跨用户保持.
  void options.reason;
}
