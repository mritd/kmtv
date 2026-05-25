/**
 * ChangePasswordForm — modal form for updating a user's password.
 * ChangePasswordForm — 修改用户密码的弹窗表单.
 *
 * Responsibilities / 职责:
 *   - Validate that new_password is non-empty and confirm_password matches — 校验新密码非空且确认密码一致
 *   - Provide real-time mismatch feedback as confirm_password is typed — 实时反馈确认密码不匹配
 *   - Submit via useUsersMutations.update (reuses update, setting only password) — 通过 update mutation 提交
 *   - Show toast on mutation error — mutation 错误时显示 toast
 *
 * Key exports / 主要导出:
 *   ChangePasswordForm
 *
 * Callers / 调用方:
 *   admin/AdminModal.tsx (kind: "user.password")
 *   admin/AdminPage.tsx (onChangePassword — for currently signed-in admin)
 */
import { useEffect, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import type { AdminUser, UpdateUserPayload } from "@/api/types";
import { Button } from "@/shared/ui/Button";
import { toast } from "@/shared/ui/Toast";

import { useUsersMutations } from "../hooks/useUsersMutations";
import { useForm } from "./useForm";

// ChangePasswordValues holds the two controlled field values for the form.
// ChangePasswordValues 持有表单两个受控字段的值.
type ChangePasswordValues = {
  new_password: string;
  confirm_password: string;
};

/**
 * ChangePasswordForm renders the change-password modal form for the given user.
 * ChangePasswordForm 为指定用户渲染修改密码弹窗表单.
 *
 * `onDone` is called on both successful submission and cancel.
 * onDone 在提交成功和取消时均会被调用.
 */
export function ChangePasswordForm({ user, onDone }: { user: AdminUser; onDone: () => void }) {
  const { t } = useTranslation("admin");
  const mutations = useUsersMutations();
  const { values, setField, errors, validate, setErrors } = useForm<ChangePasswordValues>(
    { new_password: "", confirm_password: "" },
    {
      new_password: (value) => (value ? undefined : t("user.password.errors.newRequired")),
      // confirm_password validator checks equality against the full form — cross-field.
      // confirm_password 校验函数通过完整表单值跨字段检查相等性.
      confirm_password: (value, form) =>
        value === form.new_password ? undefined : t("user.password.errors.mismatch"),
    },
  );

  // Real-time mismatch feedback: sync confirm_password error as either field changes.
  // Avoids waiting for submit to surface "passwords don't match".
  // 实时不匹配反馈: 任一字段变更时同步 confirm_password 错误.
  // 避免用户等到提交才看到"密码不一致".
  useEffect(() => {
    if (!values.confirm_password) return;
    const mismatch = values.confirm_password !== values.new_password;
    setErrors((prev) => {
      if (mismatch) {
        // Already showing mismatch error — no state update needed.
        // 已有不匹配错误 — 无需更新 state.
        if (prev.confirm_password) return prev;
        return { ...prev, confirm_password: t("user.password.errors.mismatch") };
      }
      // Passwords now match — clear the error if present.
      // 密码已一致 — 若存在错误则清除.
      if (!prev.confirm_password) return prev;
      const { confirm_password: _omit, ...rest } = prev;
      return rest;
    });
  }, [values.confirm_password, values.new_password, setErrors, t]);

  const pending = mutations.update.isPending;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validate()) return;
    // Only the password field is updated; username and role carry over unchanged.
    // 仅更新 password 字段; username 和 role 保持不变.
    const payload: UpdateUserPayload = {
      username: user.username,
      role: user.role,
      password: values.new_password,
    };
    mutations.update.mutate(
      { id: user.id, payload },
      {
        onSuccess: onDone,
        onError: (error) => {
          toast.error({
            title: t("errors.saveFailed"),
            description: error instanceof Error ? error.message : undefined,
          });
        },
      },
    );
  }

  return (
    <form className="admin-form change-password-form" onSubmit={onSubmit}>
      <h2 id="admin-modal-title">{t("user.password.title")}</h2>
      <label>
        <span>{t("user.password.newPasswordLabel")}</span>
        <input
          type="password"
          value={values.new_password}
          onChange={(e) => setField("new_password", e.target.value)}
          aria-label={t("user.password.newPasswordLabel")}
        />
        <small className="form-error" role="alert">{errors.new_password ?? ""}</small>
      </label>
      <label>
        <span>{t("user.password.confirmPasswordLabel")}</span>
        <input
          type="password"
          value={values.confirm_password}
          onChange={(e) => setField("confirm_password", e.target.value)}
          aria-label={t("user.password.confirmPasswordLabel")}
        />
        <small className="form-error" role="alert">{errors.confirm_password ?? ""}</small>
      </label>
      <div className="admin-form-actions">
        <Button type="button" variant="secondary" onClick={onDone}>
          {t("formActions.cancel")}
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? t("formActions.saving") : t("formActions.save")}
        </Button>
      </div>
    </form>
  );
}
