/**
 * useForm — lightweight typed local form state with field-scoped validation.
 * useForm — 轻量级带字段校验的本地表单状态 hook.
 *
 * Responsibilities / 职责:
 *   - Hold form field values in React state — 以 React state 持有表单字段值
 *   - Run field-scoped validator functions on submit — 提交时按字段运行校验函数
 *   - Clear per-field error eagerly when the field changes — 字段变更时提前清除该字段错误
 *   - Expose `setErrors` so callers can inject cross-field errors (e.g. confirm-password sync)
 *     暴露 setErrors 供调用方注入跨字段错误 (如密码确认同步)
 *
 * Key exports / 主要导出:
 *   Validator, useForm
 *
 * Callers / 调用方:
 *   admin/forms/ChangePasswordForm.tsx
 *   admin/forms/SourceForm.tsx
 *   admin/forms/SubscriptionForm.tsx
 *   admin/forms/UserForm.tsx
 *
 * TIER 3 LOCKED — signature changes (parameter names, return shape) require architect approval.
 * Tier 3 锁定 — 参数名或返回形态的变更需要架构师批准.
 */

import { useCallback, useState } from "react";

/**
 * Validator is a per-field validation function.
 * Validator 是单字段校验函数.
 *
 * Returns an error message string when the value is invalid, or `undefined` when valid.
 * The full form values are passed as the second argument for cross-field checks.
 * 值无效时返回错误字符串, 有效时返回 undefined.
 * 第二个参数为完整表单值, 用于跨字段校验.
 */
export type Validator<TValue, TForm> = (value: TValue, form: TForm) => string | undefined;

/**
 * useForm provides a typed local form state with field-scoped validators.
 * useForm 提供带字段校验的本地表单状态.
 *
 * @param initial - initial form values / 初始表单值
 * @param validators - optional map of field validators / 可选的字段校验函数映射
 *
 * @returns values, setField, errors, validate, setErrors
 *
 * `setField` clears the field's error immediately on change — no stale errors.
 * setField 在字段变更时立即清除该字段错误, 不保留旧错误.
 *
 * `validate` runs all validators and returns true when the form is valid.
 * validate 运行所有校验函数, 全部通过时返回 true.
 *
 * `setErrors` is exposed for callers that need to set cross-field errors imperatively
 * (e.g. real-time confirm-password mismatch in ChangePasswordForm).
 * setErrors 暴露给需要命令式设置跨字段错误的调用方
 * (如 ChangePasswordForm 中的实时密码确认不一致检查).
 */
export function useForm<T extends Record<string, unknown>>(
  initial: T,
  validators?: { [K in keyof T]?: Validator<T[K], T> },
) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});

  // setField updates a single field and eagerly clears its error if present.
  // setField 更新单个字段, 若该字段有错误则立即清除.
  const setField = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((current) => {
      // Skip state update when no error exists for this key — avoids unnecessary re-renders.
      // 当前字段无错误时跳过 state 更新, 避免不必要的重渲染.
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  // validate runs all registered validators and populates the errors map.
  // Returns true only when every validator passes.
  // validate 运行所有注册的校验函数并填充错误映射.
  // 仅当所有校验通过时返回 true.
  const validate = useCallback((): boolean => {
    if (!validators) return true;
    const next: Partial<Record<keyof T, string>> = {};
    for (const key of Object.keys(validators) as Array<keyof T>) {
      const fn = validators[key];
      if (!fn) continue;
      const msg = fn(values[key], values);
      if (msg) next[key] = msg;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }, [values, validators]);

  return { values, setField, errors, validate, setErrors };
}
