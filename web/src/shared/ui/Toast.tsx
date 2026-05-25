// Global toast notification system: store, convenience API, and rendering container.
// 全局 toast 通知系统: 状态存储、便捷 API 和渲染容器.
//
// Exports: ToastTone, ToastOptions, useToastStore, toast, ToastContainer, useSessionExpiredToast.
// Callers: AppLayout mounts ToastContainer once; feature code calls toast.error/success/info/warning.
//
// Auto-dismiss schedule: error=8 s, warning=7 s, everything else=4.5 s. duration:0 pins forever.
// 自动消失时间: error 8 s, warning 7 s, 其余 4.5 s. duration 为 0 时永久显示.
//
// Capped at MAX_VISIBLE items; oldest item is dropped when the queue overflows.
// 最多显示 MAX_VISIBLE 条, 超出时丢弃最早一条.

import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { create } from "zustand";

// ToastTone is the semantic severity level of a toast.
// ToastTone 是 toast 的语义严重级别.
export type ToastTone = "info" | "warning" | "error" | "success";

// ToastOptions is the public input shape for all push calls.
// ToastOptions 是所有 push 调用的公开输入类型.
export interface ToastOptions {
  tone?: ToastTone;
  title: string;
  description?: string;
  // duration in ms; 0 disables auto-dismiss.
  // duration
  // 单位毫秒; 0 表示不自动消失.
  duration?: number;
}

// ToastItem is the internal representation stored in the queue, always with resolved defaults.
// ToastItem 是队列内部存储的表示, 始终含有已解析的默认值.
interface ToastItem extends ToastOptions {
  id: string;
  tone: ToastTone;
  duration: number;
  createdAt: number;
}

// ToastStore is the zustand store shape for the toast queue.
// ToastStore 是 toast 队列的 zustand store 类型.
interface ToastStore {
  items: ToastItem[];
  // sessionToastFiredKey deduplicates useSessionExpiredToast across host component remounts.
  // Stored here (not in a useRef) so it survives host unmount/remount and resets with the store.
  // sessionToastFiredKey 在 store 中去重 useSessionExpiredToast, 跨宿主重挂载持久, 随 store 重置.
  sessionToastFiredKey: string | null;
  // Push without specifying a tone (back-compat with the previous message API).
  // push
  // 不指定 tone 时使用 info, 兼容旧的 message API.
  push(input: ToastOptions | { message: string; tone?: ToastTone }): string;
  dismiss(id: string): void;
}

// MAX_VISIBLE caps the number of simultaneously visible toast cards.
// MAX_VISIBLE 限制同时可见的 toast 卡片数量.
const MAX_VISIBLE = 4;

// defaultDuration returns the auto-dismiss timeout for a given tone.
// defaultDuration 返回给定 tone 的自动消失超时.
function defaultDuration(tone: ToastTone): number {
  if (tone === "error") return 8000;
  if (tone === "warning") return 7000;
  return 4500;
}

// nextId generates a unique identifier for each toast item.
// nextId 为每条 toast 生成唯一标识符.
// Falls back to Math.random in environments without crypto.randomUUID.
// 不支持 crypto.randomUUID 的环境降级到 Math.random.
function nextId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `toast-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

// useToastStore exposes the global toast queue.
// useToastStore
// 暴露全局 toast 队列.
export const useToastStore = create<ToastStore>((set, get) => ({
  items: [],
  sessionToastFiredKey: null,
  push: (input) => {
    const id = nextId();
    // Back-compat path: { message, tone? } maps to title.
    // 兼容旧调用: 用 message 字段时映射到 title.
    const normalized: Omit<ToastItem, "id" | "createdAt"> =
      "title" in input
        ? {
            tone: input.tone ?? "info",
            title: input.title,
            description: input.description,
            duration: input.duration ?? defaultDuration(input.tone ?? "info"),
          }
        : {
            tone: input.tone ?? "info",
            title: input.message,
            duration: defaultDuration(input.tone ?? "info"),
          };
    set((s) => {
      const next: ToastItem = { id, createdAt: Date.now(), ...normalized };
      const items = [...s.items, next];
      // Drop oldest when exceeding cap.
      // 超过上限时丢弃最早一条.
      while (items.length > MAX_VISIBLE) items.shift();
      return { items };
    });
    if (normalized.duration > 0) {
      window.setTimeout(() => get().dismiss(id), normalized.duration);
    }
    return id;
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

// toast is the convenience API for callers that do not need to interact with the store directly.
// toast 是调用方无需直接操作 store 时的便捷 API.
export const toast = {
  error: (input: Omit<ToastOptions, "tone">) => useToastStore.getState().push({ ...input, tone: "error" }),
  success: (input: Omit<ToastOptions, "tone">) => useToastStore.getState().push({ ...input, tone: "success" }),
  info: (input: Omit<ToastOptions, "tone">) => useToastStore.getState().push({ ...input, tone: "info" }),
  warning: (input: Omit<ToastOptions, "tone">) => useToastStore.getState().push({ ...input, tone: "warning" }),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
};

// ToneIcon renders a small inline icon corresponding to the toast's semantic tone.
// ToneIcon 渲染与 toast 语义 tone 对应的小图标.
function ToneIcon({ tone }: { tone: ToastTone }): React.JSX.Element {
  if (tone === "success") return <span aria-hidden="true">✓</span>;
  if (tone === "error") return <span aria-hidden="true">⚠</span>;
  if (tone === "warning") return <span aria-hidden="true">!</span>;
  return <span aria-hidden="true">i</span>;
}

// ToastCard renders a single animated toast notification card.
// ToastCard 渲染一张动效 toast 通知卡片.
// Uses role="alert" for error/warning (assertive) and role="status" for info/success (polite).
// error/warning 使用 role="alert" (assertive), info/success 使用 role="status" (polite).
function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss(): void }): React.JSX.Element {
  const reduce = useReducedMotion() ?? false;
  const ariaProps = item.tone === "error" || item.tone === "warning"
    ? { role: "alert" as const, "aria-live": "assertive" as const }
    : { role: "status" as const, "aria-live": "polite" as const };
  return (
    <motion.div
      layout
      initial={reduce ? { opacity: 0 } : { opacity: 0, x: 32 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, x: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: 32 }}
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 32 }}
      className={`toast toast-${item.tone}`}
      {...ariaProps}
    >
      <span className="toast-icon" aria-hidden="true">
        <ToneIcon tone={item.tone} />
      </span>
      <div className="toast-body">
        <strong className="toast-title">{item.title}</strong>
        {item.description ? <span className="toast-description">{item.description}</span> : null}
      </div>
      <button
        type="button"
        className="toast-close"
        onClick={onDismiss}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </motion.div>
  );
}

// ToastContainer is the single mount point for the toast stack; place it at app root level.
// ToastContainer 是 toast 栈的唯一挂载点, 应放在应用根层级.
export function ToastContainer(): React.JSX.Element {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className="toast-stack" aria-label="Notifications">
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

// useSessionExpiredToast bridges AuthContext clear reasons to user-visible toasts.
// useSessionExpiredToast
// 把认证清除原因桥接为可见 toast.
// Fires at most once per unique (reason, message) pair to guard against both Strict Mode
// double-mount AND host component remount (e.g. user navigates away and back while the
// lastClearReason is still "unauthorized").
// Dedup key is stored in the zustand store (not a per-instance useRef) so it survives host
// unmount/remount without re-firing. The store resets the key when the store is reset (e.g. in tests).
// When the reason transitions to a non-toastable value (null / unrecognised), the key is cleared
// so a future auth cycle with the same reason can fire again.
// 每个唯一 (原因, 消息) 对最多触发一次, 防止 Strict Mode 双次挂载和宿主组件重挂载导致的重复弹出.
// 去重 key 存于 zustand store (而非实例级 useRef), 跨宿主卸载/重挂载持久; store 重置时 key 同步清除.
// 当 reason 变为不可弹 toast 的值 (null / 未知) 时清除 key, 以便后续新的认证周期能正常触发 toast.
export function useSessionExpiredToast(lastClearReason: string | null, message: string): void {
  useEffect(() => {
    const isToastableReason =
      lastClearReason === "unauthorized" ||
      lastClearReason === "expired" ||
      lastClearReason === "external";

    if (!isToastableReason) {
      // Reason cleared (e.g. user logged in again) — reset the dedup key so the next auth
      // expiry in a fresh session can fire the toast even if the reason key is the same.
      // 原因已清除 (如用户已重新登录) — 重置去重 key, 使下一次认证过期能正常触发 toast.
      useToastStore.setState({ sessionToastFiredKey: null });
      return;
    }

    const key = `${lastClearReason}:${message}`;
    // Read the current dedup key from the store — survives host component remount.
    // 从 store 读取当前去重 key — 跨宿主重挂载持久.
    const { sessionToastFiredKey } = useToastStore.getState();
    if (sessionToastFiredKey === key) return;
    // Write the key and push the toast atomically so no concurrent effect can race past the guard.
    // 原子写入 key 并推送 toast, 避免并发 effect 绕过保护.
    useToastStore.setState({ sessionToastFiredKey: key });
    useToastStore.getState().push({ tone: "warning", title: message });
  }, [lastClearReason, message]);
}
