/**
 * AccountPage — user account management route (/account).
 * AccountPage — 用户账号管理路由 (/account).
 *
 * Responsibilities / 职责:
 *   - Show the profile editor (username + avatar) for authenticated users.
 *     为已认证用户显示 profile 编辑器 (用户名 + 头像).
 *   - Show LoginPromptCard in place of the profile editor for anonymous users.
 *     匿名用户时以 LoginPromptCard 替代 profile 编辑器.
 *   - Always show ThemeSettings regardless of auth state.
 *     无论认证状态, 始终显示主题设置.
 *   - Submit profile updates via the API and surface success / error toasts.
 *     通过 API 提交 profile 更新, 显示成功/失败 Toast.
 *
 * Key exports / 主要导出:
 *   AccountPage
 *
 * Callers / 调用方:
 *   app/AppRoutes.tsx (mounted at /account; accessible without login per anonymous-mode design)
 */
import type { FormEvent } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { APIError } from "@/api/client";
import { useAPI } from "@/api/context";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/shared/ui/Button";
import { PageHeader } from "@/shared/ui/PageHeader";
import { toast } from "@/shared/ui/Toast";

import { AvatarField } from "./AvatarField";
import { LoginPromptCard } from "./LoginPromptCard";
import { ThemeSettings } from "./ThemeSettings";

/**
 * AccountPage is the root component for the /account route.
 * AccountPage 是 /account 路由的根组件.
 *
 * The profile form is only rendered when `auth.isAnonymous` is false.
 * Anonymous visitors see LoginPromptCard instead so they can navigate to /login.
 * 仅当 auth.isAnonymous 为 false 时渲染 profile 表单.
 * 匿名访客显示 LoginPromptCard 以引导登录.
 */
export function AccountPage() {
  const { t } = useTranslation("account");
  const auth = useAuth();
  const api = useAPI();
  const [username, setUsername] = useState(auth.user?.username ?? "");

  // saveProfile submits the trimmed username to the API and refreshes the auth snapshot on success.
  // The error handler prefers the APIError message (server-supplied) over generic Error.message.
  // saveProfile 将修剪后的用户名提交到 API, 成功后刷新 auth 快照.
  // 错误处理优先使用 APIError 消息 (服务端返回), 其次用 Error.message.
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const updated = await api.updateProfile(username.trim());
      auth.updateUser(updated);
      toast.success({ title: t("updateSuccess") });
    } catch (err) {
      const description = err instanceof APIError ? err.message : err instanceof Error ? err.message : undefined;
      toast.error({ title: t("updateFailed"), description });
    }
  }

  return (
    <main className="page account-page">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <section className="account-grid">
        {auth.isAnonymous ? (
          <LoginPromptCard />
        ) : (
          <form className="settings-panel" onSubmit={saveProfile}>
            <div className="heading-block">
              <h2>{auth.user?.username}</h2>
              <p className="muted">{auth.user?.role === "admin" ? t("roleAdmin") : t("roleUser")}</p>
            </div>
            <AvatarField />
            <label>
              {t("usernameLabel")}
              <input value={username} onChange={(event) => setUsername(event.target.value)} />
            </label>
            <div className="row-actions">
              <Button type="submit" variant="primary">
                {t("saveProfile")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => void auth.logout()}>
                {t("logout")}
              </Button>
            </div>
          </form>
        )}
        <ThemeSettings />
      </section>
    </main>
  );
}
