/**
 * UserForm — create / edit form for a user account (admin view).
 * UserForm — 用户账户的新建 / 编辑表单 (管理员视图).
 *
 * Responsibilities / 职责:
 *   - Validate username as required; password as required only when creating — 校验用户名必填; 仅新建时校验密码必填
 *   - Require a matching password confirmation when creating, with live mismatch feedback — 新建时要求二次确认密码并实时提示不一致
 *   - Hide password fields in edit mode (password changes go through ChangePasswordForm) — 编辑模式下隐藏密码字段
 *   - Dispatch create or update mutation based on whether a user is provided — 根据是否传入 user 分发 mutation
 *   - Show toast on mutation error — mutation 错误时显示 toast
 *
 * Key exports / 主要导出:
 *   UserForm
 *
 * Callers / 调用方:
 *   admin/AdminModal.tsx (kind: "user.edit" | "user.new")
 */
import { type FormEvent, useEffect } from "react";
import { useTranslation } from "react-i18next";

import type { AdminUser, CreateUserPayload, UpdateUserPayload } from "@/api/types";
import { Button } from "@/shared/ui/Button";
import { Select } from "@/shared/ui/Select";
import { toast } from "@/shared/ui/Toast";

import { useUsersMutations } from "../hooks/useUsersMutations";
import { useForm } from "./useForm";

// UserFormValues holds the editable fields for create/edit.
// UserFormValues 持有新建/编辑的可编辑字段.
type UserFormValues = {
  username: string;
  password: string;
  confirmPassword: string;
  role: "admin" | "user";
  allowAdultContent: boolean;
};

/**
 * UserForm renders the user create/edit modal form.
 * UserForm 渲染用户新建/编辑弹窗表单.
 *
 * When `user` is undefined the form is in "new" mode; otherwise "edit" mode.
 * user 为 undefined 时为新建模式, 否则为编辑模式.
 *
 * In edit mode the password field is hidden — use ChangePasswordForm to update it.
 * 编辑模式下隐藏密码字段 — 密码修改通过 ChangePasswordForm 完成.
 */
export function UserForm({ user, onDone }: { user?: AdminUser; onDone: () => void }) {
  const { t } = useTranslation("admin");
  const mutations = useUsersMutations();
  const isEdit = !!user;
  const { values, setField, errors, validate, setErrors } = useForm<UserFormValues>(
    {
      username: user?.username ?? "",
      password: "",
      confirmPassword: "",
      role: user?.role ?? "user",
      allowAdultContent: user?.allow_adult_content ?? false,
    },
    {
      username: (value) => (value.trim() ? undefined : t("user.form.errors.usernameRequired")),
      // Password is only required when creating; in edit mode it is hidden and not sent.
      // 密码仅新建时必填; 编辑模式下隐藏且不发送.
      password: (value) => (isEdit ? undefined : value ? undefined : t("user.form.errors.passwordRequired")),
      // confirmPassword must equal password (create mode only); cross-field via the full form.
      // confirmPassword 必须与 password 相等 (仅新建模式); 通过完整表单值跨字段校验.
      confirmPassword: (value, form) =>
        isEdit || value === form.password ? undefined : t("user.password.errors.mismatch"),
    },
  );

  // Real-time mismatch feedback (create mode): sync confirmPassword error as either field changes,
  // mirroring ChangePasswordForm so users don't wait for submit to see "passwords don't match".
  // 实时不匹配反馈 (新建模式): 任一字段变更时同步 confirmPassword 错误, 与 ChangePasswordForm 一致,
  // 避免用户等到提交才看到"两次密码不一致".
  useEffect(() => {
    if (isEdit) return;
    if (!values.confirmPassword) return;
    const mismatch = values.confirmPassword !== values.password;
    setErrors((prev) => {
      if (mismatch) {
        if (prev.confirmPassword) return prev;
        return { ...prev, confirmPassword: t("user.password.errors.mismatch") };
      }
      if (!prev.confirmPassword) return prev;
      const { confirmPassword: _omit, ...rest } = prev;
      return rest;
    });
  }, [values.confirmPassword, values.password, isEdit, setErrors, t]);

  const pending = mutations.create.isPending || mutations.update.isPending;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validate()) return;
    const onError = (error: unknown) => {
      toast.error({
        title: t("errors.saveFailed"),
        description: error instanceof Error ? error.message : undefined,
      });
    };
    if (isEdit && user) {
      // Edit path: username, role, and adult-content policy are sent; password is managed separately.
      // 编辑路径: 发送 username, role 和成人内容策略; 密码通过单独入口管理.
      const payload: UpdateUserPayload = {
        username: values.username,
        role: values.role,
        allow_adult_content: values.allowAdultContent,
      };
      mutations.update.mutate({ id: user.id, payload }, { onSuccess: onDone, onError });
    } else {
      const payload: CreateUserPayload = {
        username: values.username,
        password: values.password,
        role: values.role,
        allow_adult_content: values.allowAdultContent,
      };
      mutations.create.mutate(payload, { onSuccess: onDone, onError });
    }
  }

  return (
    <form className="admin-form" onSubmit={onSubmit}>
      <h2 id="admin-modal-title">{isEdit ? t("user.form.editTitle") : t("user.form.newTitle")}</h2>
      <label>
        <span>{t("user.form.usernameLabel")}</span>
        <input
          value={values.username}
          onChange={(e) => setField("username", e.target.value)}
          aria-label={t("user.form.usernameLabel")}
        />
        {errors.username ? <small className="form-error">{errors.username}</small> : null}
      </label>
      {!isEdit ? (
        <>
          <label>
            <span>{t("user.form.passwordLabel")}</span>
            <input
              type="password"
              value={values.password}
              onChange={(e) => setField("password", e.target.value)}
              aria-label={t("user.form.passwordLabel")}
            />
            {errors.password ? <small className="form-error">{errors.password}</small> : null}
          </label>
          <label>
            <span>{t("user.password.confirmPasswordLabel")}</span>
            <input
              type="password"
              value={values.confirmPassword}
              onChange={(e) => setField("confirmPassword", e.target.value)}
              aria-label={t("user.password.confirmPasswordLabel")}
            />
            {errors.confirmPassword ? <small className="form-error">{errors.confirmPassword}</small> : null}
          </label>
        </>
      ) : null}
      <label>
        <span>{t("user.form.roleLabel")}</span>
        <Select
          value={values.role}
          options={[
            { value: "user", label: t("role.user") },
            { value: "admin", label: t("role.admin") },
          ]}
          onChange={(value) => setField("role", value as "admin" | "user")}
          ariaLabel={t("user.form.roleLabel")}
        />
      </label>
      <label className="form-toggle">
        <input
          type="checkbox"
          checked={values.allowAdultContent}
          onChange={(e) => setField("allowAdultContent", e.target.checked)}
          aria-label={t("user.form.allowAdultLabel")}
        />
        <span className="form-toggle-track" aria-hidden="true" />
        <span className="form-toggle-label">{t("user.form.allowAdultLabel")}</span>
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
