/**
 * SourceForm — create / edit form for a single video source.
 * SourceForm — 单个视频源的新建 / 编辑表单.
 *
 * Responsibilities / 职责:
 *   - Validate key, name, and api fields as required — 校验 key/name/api 字段必填
 *   - Auto-suggest enabled=false for NSFW-prefixed (🔞) new sources — 新建 🔞 源时自动建议 disabled
 *   - Lock auto-suggest once the user has explicitly toggled the enabled checkbox — 用户手动操作后锁定自动建议
 *   - Dispatch create or update mutation based on whether a source is provided — 根据是否传入 source 分发新建/更新 mutation
 *   - Show toast on mutation error — mutation 错误时显示 toast
 *
 * Key exports / 主要导出:
 *   SourceForm
 *
 * Callers / 调用方:
 *   admin/AdminModal.tsx (kind: "source.edit" | "source.new")
 */
import type { FormEvent } from "react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { Source, SourcePayload } from "@/api/types";
import { Button } from "@/shared/ui/Button";
import { toast } from "@/shared/ui/Toast";

import { useSourcesMutations } from "../hooks/useSourcesMutations";
import { useForm } from "./useForm";

// SourceFormValues mirrors the editable fields of SourcePayload.
// SourceFormValues 镜像 SourcePayload 的可编辑字段.
type SourceFormValues = {
  key: string;
  name: string;
  api: string;
  detail: string;
  enabled: boolean;
  searchable: boolean;
  comment: string;
};

// NSFW_PREFIX is the emoji prefix that auto-suggests enabled=false for new sources.
// NSFW_PREFIX 是触发新建源自动建议 enabled=false 的 emoji 前缀.
const NSFW_PREFIX = "🔞";

// valuesFromSource converts an optional existing Source into the form's initial values.
// valuesFromSource 将可选的已有 Source 转换为表单初始值.
function valuesFromSource(source: Source | undefined): SourceFormValues {
  return {
    key: source?.key ?? "",
    name: source?.name ?? "",
    api: source?.api ?? "",
    detail: source?.detail ?? "",
    enabled: source?.enabled ?? true,
    searchable: source?.searchable ?? true,
    comment: source?.comment ?? "",
  };
}

// payloadFromValues converts form values into the API payload shape.
// payloadFromValues 将表单值转换为 API 提交形态.
function payloadFromValues(values: SourceFormValues): SourcePayload {
  return { ...values };
}

/**
 * SourceForm renders the source create/edit modal form.
 * SourceForm 渲染视频源新建/编辑弹窗表单.
 *
 * When `source` is undefined the form is in "new" mode; otherwise "edit" mode.
 * source 为 undefined 时为新建模式, 否则为编辑模式.
 *
 * In edit mode the `key` field is disabled (keys are immutable after creation).
 * 编辑模式下 key 字段禁用 (key 创建后不可修改).
 */
export function SourceForm({ source, onDone }: { source?: Source; onDone: () => void }) {
  const { t } = useTranslation("admin");
  const mutations = useSourcesMutations();
  const isEdit = !!source;
  const { values, setField, errors, validate } = useForm<SourceFormValues>(valuesFromSource(source), {
    key: (value) => (value.trim() ? undefined : t("source.form.errors.keyRequired")),
    name: (value) => (value.trim() ? undefined : t("source.form.errors.nameRequired")),
    api: (value) => (value.trim() ? undefined : t("source.form.errors.apiRequired")),
  });

  // enabledDirtyRef tracks whether the user has explicitly toggled enabled.
  // While clean (new-source path only), changing the name to a 🔞 prefix flips
  // enabled to false; any user toggle locks the field from automatic changes.
  // enabledDirtyRef
  // 记录用户是否手动切换过 enabled. 在未触碰时(仅新建路径), 改名到 🔞 前缀会自动设为 false;
  // 一旦用户主动操作即锁定, 后续不再自动调整.
  const enabledDirtyRef = useRef<boolean>(isEdit);

  // Auto-suggest enabled=false for NSFW-named new sources until the user opts in.
  // 新建 🔞 源时, 在用户未手动操作前自动建议 enabled=false.
  useEffect(() => {
    if (isEdit) return;
    if (enabledDirtyRef.current) return;
    const shouldDisable = values.name.startsWith(NSFW_PREFIX);
    if (shouldDisable && values.enabled) {
      setField("enabled", false);
    } else if (!shouldDisable && !values.enabled) {
      setField("enabled", true);
    }
  }, [values.name, values.enabled, isEdit, setField]);

  // handleEnabledChange marks the field as user-controlled and updates the value.
  // handleEnabledChange 将字段标记为用户控制并更新值.
  function handleEnabledChange(next: boolean) {
    enabledDirtyRef.current = true;
    setField("enabled", next);
  }

  const pending = mutations.create.isPending || mutations.update.isPending;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validate()) return;
    const payload = payloadFromValues(values);
    const onError = (error: unknown) => {
      toast.error({
        title: t("errors.saveFailed"),
        description: error instanceof Error ? error.message : undefined,
      });
    };
    if (isEdit && source) {
      mutations.update.mutate({ id: source.id, payload }, { onSuccess: onDone, onError });
    } else {
      mutations.create.mutate(payload, { onSuccess: onDone, onError });
    }
  }

  return (
    <form className="admin-form" onSubmit={onSubmit}>
      <h2 id="admin-modal-title">{isEdit ? t("source.form.editTitle") : t("source.form.newTitle")}</h2>

      <label>
        <span>{t("source.form.keyLabel")}</span>
        <input value={values.key} onChange={(e) => setField("key", e.target.value)} disabled={isEdit} aria-label={t("source.form.keyLabel")} />
        {errors.key ? <small className="form-error">{errors.key}</small> : null}
      </label>

      <label>
        <span>{t("source.form.nameLabel")}</span>
        <input value={values.name} onChange={(e) => setField("name", e.target.value)} aria-label={t("source.form.nameLabel")} />
        {errors.name ? <small className="form-error">{errors.name}</small> : null}
      </label>

      <label>
        <span>{t("source.form.apiLabel")}</span>
        <input value={values.api} onChange={(e) => setField("api", e.target.value)} aria-label={t("source.form.apiLabel")} />
        {errors.api ? <small className="form-error">{errors.api}</small> : null}
      </label>

      <label>
        <span>{t("source.form.detailLabel")}</span>
        <input value={values.detail} onChange={(e) => setField("detail", e.target.value)} aria-label={t("source.form.detailLabel")} />
      </label>

      <label className="form-toggle">
        <input type="checkbox" checked={values.enabled} onChange={(e) => handleEnabledChange(e.target.checked)} />
        <span className="form-toggle-track" aria-hidden="true" />
        <span className="form-toggle-label">{t("source.form.enabledLabel")}</span>
      </label>

      <label className="form-toggle">
        <input type="checkbox" checked={values.searchable} onChange={(e) => setField("searchable", e.target.checked)} />
        <span className="form-toggle-track" aria-hidden="true" />
        <span className="form-toggle-label">{t("source.form.searchableLabel")}</span>
      </label>

      <label>
        <span>{t("source.form.commentLabel")}</span>
        <textarea value={values.comment} onChange={(e) => setField("comment", e.target.value)} aria-label={t("source.form.commentLabel")} />
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
