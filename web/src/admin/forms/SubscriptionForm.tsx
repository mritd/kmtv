/**
 * SubscriptionForm — create / edit form for a single subscription record.
 * SubscriptionForm — 单条订阅记录的新建 / 编辑表单.
 *
 * Responsibilities / 职责:
 *   - Validate url as required and interval as positive — 校验 url 必填、interval 为正数
 *   - Dispatch create or update mutation based on whether a subscription is provided — 根据是否传入 subscription 分发 mutation
 *   - Show toast on mutation error — mutation 错误时显示 toast
 *
 * Key exports / 主要导出:
 *   SubscriptionForm
 *
 * Callers / 调用方:
 *   admin/AdminModal.tsx (kind: "subscription.edit" | "subscription.new")
 */
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";

import type { Subscription, SubscriptionPayload } from "@/api/types";
import { Button } from "@/shared/ui/Button";
import { toast } from "@/shared/ui/Toast";

import { useSubscriptionsMutations } from "../hooks/useSubscriptionsMutations";
import { useForm } from "./useForm";

// SubscriptionFormValues mirrors the editable fields of SubscriptionPayload.
// SubscriptionFormValues 镜像 SubscriptionPayload 的可编辑字段.
type SubscriptionFormValues = {
  url: string;
  auto_update: boolean;
  interval: number;
};

// valuesFromSubscription converts an optional existing Subscription into the form's initial values.
// valuesFromSubscription 将可选的已有 Subscription 转换为表单初始值.
function valuesFromSubscription(subscription: Subscription | undefined): SubscriptionFormValues {
  return {
    url: subscription?.url ?? "",
    auto_update: subscription?.auto_update ?? true,
    interval: subscription?.interval ?? 3600,
  };
}

// payloadFromValues converts form values into the API payload shape.
// payloadFromValues 将表单值转换为 API 提交形态.
function payloadFromValues(values: SubscriptionFormValues): SubscriptionPayload {
  return { ...values };
}

/**
 * SubscriptionForm renders the subscription create/edit modal form.
 * SubscriptionForm 渲染订阅新建/编辑弹窗表单.
 *
 * When `subscription` is undefined the form is in "new" mode; otherwise "edit" mode.
 * subscription 为 undefined 时为新建模式, 否则为编辑模式.
 */
export function SubscriptionForm({
  subscription,
  onDone,
}: {
  subscription?: Subscription;
  onDone: () => void;
}) {
  const { t } = useTranslation("admin");
  const mutations = useSubscriptionsMutations();
  const isEdit = !!subscription;
  const { values, setField, errors, validate } = useForm<SubscriptionFormValues>(
    valuesFromSubscription(subscription),
    {
      url: (value) => (value.trim() ? undefined : t("subscription.form.errors.urlRequired")),
      interval: (value) => (value > 0 ? undefined : t("subscription.form.errors.intervalPositive")),
    },
  );

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
    if (isEdit && subscription) {
      mutations.update.mutate({ id: subscription.id, payload }, { onSuccess: onDone, onError });
    } else {
      mutations.create.mutate(payload, { onSuccess: onDone, onError });
    }
  }

  return (
    <form className="admin-form" onSubmit={onSubmit}>
      <h2 id="admin-modal-title">{isEdit ? t("subscription.form.editTitle") : t("subscription.form.newTitle")}</h2>
      <label>
        <span>{t("subscription.form.urlLabel")}</span>
        <input value={values.url} onChange={(e) => setField("url", e.target.value)} aria-label={t("subscription.form.urlLabel")} />
        {errors.url ? <small className="form-error">{errors.url}</small> : null}
      </label>
      <label>
        <span>{t("subscription.form.intervalLabel")}</span>
        <input
          type="number"
          value={values.interval}
          onChange={(e) => setField("interval", Number(e.target.value))}
          aria-label={t("subscription.form.intervalLabel")}
          min={1}
        />
        {errors.interval ? <small className="form-error">{errors.interval}</small> : null}
      </label>
      <label className="form-toggle">
        <input type="checkbox" checked={values.auto_update} onChange={(e) => setField("auto_update", e.target.checked)} />
        <span className="form-toggle-track" aria-hidden="true" />
        <span className="form-toggle-label">{t("subscription.form.autoUpdateLabel")}</span>
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
