/**
 * useUsersMutations — React Query mutation hooks for all user CRUD operations.
 * useUsersMutations — 所有用户 CRUD 操作的 React Query mutation hooks.
 *
 * Responsibilities / 职责:
 *   - Provide create, update, remove mutations — 提供 create/update/remove mutations
 *   - Invalidate the ["admin", "users"] cache after every successful mutation
 *     每次成功 mutation 后使 ["admin", "users"] 缓存失效
 *
 * Key exports / 主要导出:
 *   useUsersMutations
 *
 * Callers / 调用方:
 *   admin/forms/UserForm.tsx
 *   admin/forms/ChangePasswordForm.tsx
 *   admin/UsersPanel.tsx
 *
 * React Query key contract (TIER 4 LOCKED):
 *   invalidates ["admin", "users"] — must match useUsersQuery key in adminHooks.ts
 * Tier 4 锁定 — 不得更改 invalidateQueries key; 必须与 adminHooks.ts 中 useUsersQuery key 一致.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useAPI } from "@/api/context";
import type { CreateUserPayload, UpdateUserPayload } from "@/api/types";

/**
 * useUsersMutations returns all CRUD mutations for user accounts.
 * useUsersMutations 返回用户账户所有 CRUD mutations.
 *
 * All mutations share the same `invalidate` callback that drops the users list cache.
 * 所有 mutations 共享同一 invalidate 回调以清除用户列表缓存.
 *
 * `update` is also used by ChangePasswordForm to change a user's password
 * (the payload carries the new password alongside username and role).
 * update 同样被 ChangePasswordForm 用于修改用户密码
 * (payload 中携带新密码, 同时包含 username 和 role).
 */
export function useUsersMutations() {
  const api = useAPI();
  const queryClient = useQueryClient();

  // invalidate drops the users list from the cache so the panel re-fetches fresh data.
  // invalidate 清除用户列表缓存, 让面板重新获取最新数据.
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
  };

  return {
    /** create — creates a new user account and invalidates the users list. / 新建用户账户并使用户列表缓存失效. */
    create: useMutation({
      mutationFn: (payload: CreateUserPayload) => api.createUser(payload),
      onSuccess: invalidate,
    }),
    /**
     * update — updates an existing user by id (username, role, or password).
     * update — 通过 id 更新已有用户 (username、role 或 password).
     */
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: UpdateUserPayload }) => api.updateUser(id, payload),
      onSuccess: invalidate,
    }),
    /** remove — deletes a user account by id. / 通过 id 删除用户账户. */
    remove: useMutation({
      mutationFn: (id: number) => api.deleteUser(id),
      onSuccess: invalidate,
    }),
  };
}
