/**
 * LoginPage — credential form that drives auth.login() and handles open-redirect prevention.
 * LoginPage — 凭据表单, 驱动 auth.login() 并处理开放重定向防护.
 *
 * Responsibilities / 职责:
 *   - Render username + password inputs and a submit button — 渲染用户名/密码输入框和提交按钮
 *   - Validate the ?next= query param against open-redirect patterns — 校验 ?next= 参数防止开放重定向
 *   - Surface login errors via Toast without crashing — 通过 Toast 展示登录错误而不崩溃
 *   - Redirect to safeNext (or "/") after successful login — 登录成功后重定向到安全目标 (或 "/")
 *
 * Key exports / 主要导出:
 *   LoginPage
 *
 * Callers / 调用方:
 *   AppRoutes (renders on /login path)
 *   BootGate (redirects unauthenticated visitors here with ?next=)
 *
 * Anonymous mode note: anonymous users can navigate to /login and see this form;
 * AppRoutes only redirects away from /login when auth.isAuthenticated is true.
 * In anonymous-access mode the user simply stays on the login form if they visit it directly.
 * 匿名模式说明: 匿名用户可以访问 /login 并看到此表单;
 * AppRoutes 仅在 auth.isAuthenticated 为 true 时才从 /login 重定向.
 * 匿名访问模式下用户直接访问登录页时仍会看到此表单.
 */

import { type FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { APIError } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/shared/ui/Button";
import { toast } from "@/shared/ui/Toast";

/**
 * LoginPage is the credential form shown to unauthenticated visitors.
 * LoginPage 是展示给未认证访客的凭据表单.
 *
 * After a successful login the component navigates to the ?next= param or "/".
 * The ?next= value is sanitised to reject absolute URLs, protocol-relative URLs,
 * and backslash-prefixed paths (open-redirect vectors).
 * 登录成功后跳转到 ?next= 参数或 "/".
 * ?next= 值经过净化以拒绝绝对 URL、协议相对 URL 和反斜杠路径 (开放重定向攻击向量).
 */
export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // next must be a same-origin path; reject anything that could be an absolute URL,
  // a protocol-relative URL, or a backslash-prefixed bypass.
  // next 必须是同源路径; 拒绝绝对 URL, 协议相对 URL 和反斜杠绕过, 防止 open-redirect.
  const rawNext = params.get("next");
  const safeNext =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/\\")
      ? rawNext
      : "/";
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    try {
      await auth.login(username, password);
      // tokenStore subscription drives status to authenticated; navigate now
      // so the user lands on next (or home) once the new route tree renders.
      // 登录成功后导航到 next 或 home; tokenStore 订阅会驱动 status 变为 authenticated.
      navigate(safeNext, { replace: true });
    } catch (err) {
      const description = err instanceof APIError ? err.message : err instanceof Error ? err.message : undefined;
      toast.error({ title: "Login failed", description });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <h1>KMTV</h1>
        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </label>
        <label>
          Password
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" />
        </label>
        <Button type="submit" variant="primary" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </Button>
      </form>
    </main>
  );
}
