/**
 * BootGate — guards the route tree until the auth boot-probe resolves.
 * BootGate — 在认证启动探测完成前拦截路由树渲染.
 *
 * During the "probing" phase AuthContext is waiting for /auth/me to respond.
 * Rendering routes while probing would cause a flash of the wrong page (e.g. login
 * form appearing briefly before the server confirms anonymous access). BootGate
 * swaps in BootSplash until the probe settles to any non-probing status.
 * 在 "probing" 阶段 AuthContext 正等待 /auth/me 响应.
 * 在探测期间渲染路由会导致错误页面短暂闪烁 (例如在服务器确认匿名访问之前短暂出现登录表单).
 * BootGate 在探测结束 (status 不为 "probing") 之前以 BootSplash 替代路由树.
 *
 * TIER 4 LOCKED — do NOT change the probe semantics or add early-exit conditions.
 * AuthContext guarantees the probe resolves within PROBE_TIMEOUT_MS (1500 ms).
 * TIER 4 锁定 — 不得修改探测语义或添加提前退出条件.
 * AuthContext 保证探测在 PROBE_TIMEOUT_MS (1500 ms) 内完成.
 *
 * Key exports / 主要导出:
 *   BootGate
 *
 * Callers / 调用方:
 *   AppShell.tsx — wraps AppRoutes inside BootGate, inside AuthProvider
 */

import type { ReactNode } from "react";

import { useAuth } from "@/auth/AuthContext";
import { BootSplash } from "@/shared/ui/BootSplash";

/**
 * BootGate shows BootSplash while auth status is "probing", then renders children.
 * BootGate 在认证状态为 "probing" 时显示 BootSplash, 之后渲染子树.
 *
 * The check is intentionally the only condition — never add "authenticated" shortcuts here
 * because the anonymous path also needs to render and the probe can flip either way.
 * 条件检查故意只判断 "probing" — 不要在此添加 "authenticated" 快捷路径,
 * 因为匿名路径同样需要渲染, 且探测结果可能是任意一种非 probing 状态.
 */
export function BootGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status.kind === "probing") return <BootSplash />;
  return <>{children}</>;
}
