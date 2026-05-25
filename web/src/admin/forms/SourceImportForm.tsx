/**
 * SourceImportForm — modal form for bulk-importing sources from a JSON bundle.
 * SourceImportForm — 从 JSON bundle 批量导入视频源的弹窗表单.
 *
 * Responsibilities / 职责:
 *   - Accept raw JSON text and parse it client-side before submission — 接受原始 JSON 文本并在提交前客户端解析
 *   - Validate that the parsed value is a non-array object — 校验解析结果为非数组对象
 *   - Dispatch importBundle mutation and show result count in toast — 触发 importBundle mutation 并通过 toast 显示导入数量
 *   - Show toast on mutation error — mutation 错误时显示 toast
 *
 * Key exports / 主要导出:
 *   SourceImportForm
 *
 * Callers / 调用方:
 *   admin/AdminModal.tsx (kind: "source.import")
 */
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/ui/Button";
import { toast } from "@/shared/ui/Toast";

import { useSourcesMutations } from "../hooks/useSourcesMutations";

/**
 * SourceImportForm renders the JSON bundle import modal form.
 * SourceImportForm 渲染 JSON bundle 导入弹窗表单.
 *
 * The textarea accepts a raw JSON object (not an array).
 * The bundle is forwarded to the API as-is after client-side validation.
 * textarea 接受原始 JSON 对象 (非数组).
 * 客户端校验通过后 bundle 原样转发给 API.
 */
export function SourceImportForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation("admin");
  const mutations = useSourcesMutations();
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Surface a user-visible error instead of swallowing the parse failure.
      // 向用户显示解析错误而非静默吞掉.
      setError(t("source.import.errorInvalidJson"));
      return;
    }
    // Reject non-object payloads (arrays, primitives) — the API expects an object bundle.
    // 拒绝非对象 payload (数组、基本类型) — API 期望对象 bundle.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setError(t("source.import.errorRequired"));
      return;
    }
    mutations.importBundle.mutate(parsed as Record<string, unknown>, {
      onSuccess: (data) => {
        toast.success({ title: t("source.import.result", { count: data?.imported ?? 0 }) });
        onDone();
      },
      onError: (err) => {
        toast.error({
          title: t("errors.saveFailed"),
          description: err instanceof Error ? err.message : undefined,
        });
      },
    });
  }

  return (
    <form className="admin-form" onSubmit={onSubmit}>
      <h2 id="admin-modal-title">{t("source.import.title")}</h2>
      <label>
        <span>{t("source.import.hint")}</span>
        <textarea
          rows={10}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          aria-label="Import JSON payload"
          placeholder='{"sources": [...]}'
        />
        {error ? <small className="form-error">{error}</small> : null}
      </label>
      <div className="admin-form-actions">
        <Button type="button" variant="secondary" onClick={onDone}>
          {t("formActions.cancel")}
        </Button>
        <Button type="submit" variant="primary" disabled={mutations.importBundle.isPending}>
          {mutations.importBundle.isPending ? t("source.import.submitPending") : t("source.import.submit")}
        </Button>
      </div>
    </form>
  );
}
