/**
 * LoginPromptCard — anonymous-state placeholder shown in place of the account profile form.
 * LoginPromptCard — 匿名状态下替代账号 profile 表单的占位卡片.
 *
 * Responsibilities / 职责:
 *   - Render the IncognitoAvatar badge and a descriptive prompt for unauthenticated visitors.
 *     渲染 IncognitoAvatar 徽章以及对未认证访客的描述性提示.
 *   - Navigate to /login?next=%2Faccount on CTA click so the user returns to /account after login.
 *     点击 CTA 时跳转至 /login?next=%2Faccount, 使用户登录后回到 /account.
 *
 * Key exports / 主要导出:
 *   LoginPromptCard
 *
 * Callers / 调用方:
 *   account/AccountPage.tsx (rendered when auth.isAnonymous is true)
 */
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Button } from "@/shared/ui/Button";
import { IncognitoAvatar } from "@/shared/ui/IncognitoAvatar";

/**
 * LoginPromptCard replaces the profile form when the user is anonymous.
 * The `next` query param encodes the current path (/account) so LoginPage can
 * redirect back after a successful login.
 * LoginPromptCard 在匿名用户访问 /account 时替代 profile 表单.
 * `next` 查询参数编码当前路径 (/account), 让 LoginPage 登录成功后跳回.
 */
export function LoginPromptCard() {
  const { t } = useTranslation("account");
  const navigate = useNavigate();
  return (
    <section className="settings-panel login-prompt-card" aria-labelledby="login-prompt-title">
      <div className="login-prompt-icon" aria-hidden="true">
        <IncognitoAvatar label={t("anonymousBadge")} />
      </div>
      <h2 id="login-prompt-title">{t("loginPromptCard.title")}</h2>
      <p className="muted">{t("loginPromptCard.description")}</p>
      <div className="row-actions">
        <Button
          type="button"
          variant="primary"
          onClick={() => navigate("/login?next=%2Faccount")}
        >
          {t("loginPromptCard.action")}
        </Button>
      </div>
    </section>
  );
}
