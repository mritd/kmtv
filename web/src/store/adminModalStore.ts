/**
 * adminModalStore — single-active-modal controller for the admin panel.
 * adminModalStore — 管理面板的单活动弹窗控制器.
 *
 * Responsibilities / 职责:
 *   - Hold the currently open modal payload, or null when closed — 持有当前打开的弹窗上下文, 关闭时为 null
 *   - Expose open() / close() actions consumed by AdminPage and AdminModal — 暴露 open()/close() 供 AdminPage 和 AdminModal 使用
 *   - Auto-close on user switch via registerUserScopedReset — 通过 registerUserScopedReset 在用户切换时自动关闭
 *
 * State shape / 状态结构:
 *   current: AdminModalPayload | null  — active modal context (null = closed)
 *
 * Actions / 动作:
 *   open(payload)  — set the active context, replacing any previously open modal
 *   close()        — clear the context
 *
 * Callers / 调用方:
 *   admin/AdminPage.tsx        (calls open() on each action button)
 *   admin/AdminModal.tsx       (reads current to select the form to render; calls close() on dismiss)
 *   auth/authLifecycle.ts      (registerUserScopedReset callback closes on user switch)
 *   test/setup.ts              (calls close() in beforeEach to reset between tests)
 */

import { createStore } from "zustand/vanilla";

import type { AdminUser, Source, Subscription } from "@/api/types";
import { registerUserScopedReset } from "@/auth/authLifecycle";

/**
 * AdminModalPayload — discriminated union identifying which admin form is active and its data.
 * AdminModalPayload — 判别联合类型, 标识当前激活的管理表单及其数据.
 *
 * Each variant carries exactly the data the corresponding form needs:
 * - source.* variants carry a Source (or nothing for "new")
 * - subscription.* variants carry a Subscription
 * - user.* variants carry an AdminUser
 *
 * 每个变体只携带对应表单所需的数据:
 * - source.* 携带 Source (new 无数据)
 * - subscription.* 携带 Subscription
 * - user.* 携带 AdminUser
 */
export type AdminModalPayload =
  | { kind: "source.new" }
  | { kind: "source.edit"; source: Source }
  | { kind: "source.delete"; source: Source }
  | { kind: "source.import" }
  | { kind: "subscription.new" }
  | { kind: "subscription.edit"; subscription: Subscription }
  | { kind: "subscription.delete"; subscription: Subscription }
  | { kind: "user.new" }
  | { kind: "user.edit"; user: AdminUser }
  | { kind: "user.delete"; user: AdminUser }
  | { kind: "user.password"; user: AdminUser };

/**
 * AdminModalState — full state + action contract of adminModalStore.
 * AdminModalState — adminModalStore 的完整状态与 action 接口.
 *
 * `current` is null when no modal is open.
 * current 为 null 表示弹窗已关闭.
 */
export interface AdminModalState {
  current: AdminModalPayload | null;
  open(payload: AdminModalPayload): void;
  close(): void;
}

/**
 * adminModalStore — vanilla Zustand store (no React hooks required).
 * adminModalStore — 原生 Zustand store (无需 React hook).
 *
 * Using createStore (vanilla) rather than create() so non-React callers
 * (e.g. event handlers outside the render tree) can call getState() directly.
 * 使用 createStore (vanilla) 而非 create(), 使得渲染树外的事件处理器也可直接调用 getState().
 */
export const adminModalStore = createStore<AdminModalState>()((set) => ({
  current: null,
  open: (payload) => set({ current: payload }),
  close: () => set({ current: null }),
}));

// Admin modals are user-scoped:
// an open modal must not survive a user switch.
// 管理弹窗属于用户作用域: 用户切换时必须关闭.
registerUserScopedReset(() => adminModalStore.getState().close());
