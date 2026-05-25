/**
 * SystemSettingsPanel — admin panel for viewing and editing system-wide configuration.
 * SystemSettingsPanel — 查看和编辑系统全局配置的管理面板.
 *
 * Responsibilities / 职责:
 *   - Display all editable settings in a two-column read-only list by default.
 *     默认以两列只读列表展示所有可编辑配置项.
 *   - Switch to an edit form on "Edit" click; validate fields inline before submitting.
 *     点击 "编辑" 切换为编辑表单; 提交前内联校验各字段.
 *   - Sync local form state with server state on query refetch (only when not editing).
 *     查询刷新时将本地状态同步为服务端状态 (仅在非编辑状态下).
 *   - Submit only the diff (changed keys) to avoid overwriting concurrent edits on other keys.
 *     仅提交变更的键, 避免覆盖其他并发编辑.
 *   - Render InlineSettingField — a sub-component that picks the appropriate input widget
 *     based on EditableSettingEntry.kind (boolean toggle, enum select, number, url/text).
 *     渲染 InlineSettingField — 根据 EditableSettingEntry.kind 选择输入控件的子组件
 *     (布尔开关、枚举选择、数字、url/text).
 *
 * Key exports / 主要导出:
 *   SystemSettingsPanel
 *
 * Callers / 调用方:
 *   admin/AdminPage.tsx (rendered when tab === "settings")
 *
 * Settings schema lives in forms/editableSettingsSchema.ts (fe-3 scope).
 * Clamp ranges in the schema must stay aligned with server/internal/runtime/settings.go.
 * 配置模式定义在 forms/editableSettingsSchema.ts (fe-3 范围).
 * 模式中的范围约束必须与 server/internal/runtime/settings.go 保持同步.
 */
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { useAdminSettingsQuery } from "@/api/adminHooks";
import { Button } from "@/shared/ui/Button";
import { Select } from "@/shared/ui/Select";
import { StatusState } from "@/shared/ui/StatusState";
import { toast } from "@/shared/ui/Toast";

import { editableSettingsSchema, validatePublicBaseURL, type EditableSettingEntry } from "./forms/editableSettingsSchema";
import { useSettingsMutation } from "./hooks/useSettingsMutation";
import { SettingsListSkeleton } from "./skeletons/AdminTableSkeleton";

// defaultValue provides the local-state initial value for a setting when the server
// has not yet returned a value for it.  Boolean defaults to "false" (the safer option);
// enum defaults to the first option; all other kinds default to "".
// defaultValue
// 当服务端尚未返回某配置项的值时提供本地状态的初始值.
// boolean 默认 "false" (更安全的选项); enum 默认第一个选项; 其他类型默认 "".
function defaultValue(entry: EditableSettingEntry): string {
  if (entry.kind === "boolean") return "false";
  if (entry.kind === "enum" && entry.options) return entry.options[0]?.value ?? "";
  return "";
}

/**
 * SystemSettingsPanel renders the editable system settings list.
 * SystemSettingsPanel 渲染可编辑的系统配置列表.
 *
 * Renders a skeleton while loading, an error state on failure, and the two-column
 * read-only list (or edit form) on success.
 * 加载中显示骨架屏, 失败时显示错误状态, 成功时显示两列只读列表 (或编辑表单).
 */
export function SystemSettingsPanel() {
  const { t } = useTranslation("admin");
  const query = useAdminSettingsQuery();
  const mutation = useSettingsMutation();
  const [isEditing, setIsEditing] = useState(false);
  // values holds the current form state (edited or read-only mirror of server data).
  // values 持有当前表单状态 (编辑中或服务端数据的只读镜像).
  const [values, setValues] = useState<Record<string, string>>({});
  // initial is the server-side snapshot captured at the last successful fetch or save.
  // Diff against initial before submitting to send only changed keys.
  // initial 是最近一次成功获取或保存时的服务端快照.
  // 提交前与 initial 对比, 只发送变更的键.
  const [initial, setInitial] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Sync local values with server state whenever the query refetches;
  // only overwrite while not actively editing.
  // 查询刷新时同步本地状态; 编辑中不覆盖, 避免吞掉用户输入.
  useEffect(() => {
    if (!query.data) return;
    if (isEditing) return;
    const next: Record<string, string> = {};
    for (const entry of editableSettingsSchema) {
      next[entry.key] = query.data.settings[entry.key] ?? defaultValue(entry);
    }
    setValues(next);
    setInitial(next);
  }, [query.data, isEditing]);

  if (query.isLoading) return <SettingsListSkeleton rows={editableSettingsSchema.length} />;
  if (query.isError) return <StatusState title={t("settings.loadFailed")} tone="error" />;

  function startEditing() {
    setFieldErrors({});
    setIsEditing(true);
  }

  function cancelEditing() {
    setValues(initial);
    setFieldErrors({});
    setIsEditing(false);
  }

  function setField(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function validateAll(): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const entry of editableSettingsSchema) {
      const raw = values[entry.key] ?? "";
      // Only true URL fields receive URL validation; enums and other text fields
      // use their own value sets.
      // 只有真正的 URL 字段做 URL 校验; enum 等使用各自取值集合.
      if (entry.kind === "url") {
        const issue = validatePublicBaseURL(raw);
        if (issue) {
          errors[entry.key] = t(`settings.urlIssue.${issue}` as never);
        }
        continue;
      }
      if (entry.kind === "number") {
        const n = Number(raw);
        if (raw === "" || !Number.isFinite(n)) {
          errors[entry.key] = t("settings.numberRequired");
          continue;
        }
        if (entry.min !== undefined && n < entry.min) {
          errors[entry.key] = t("settings.numberOutOfRange", { min: entry.min, max: entry.max ?? "∞" });
          continue;
        }
        if (entry.max !== undefined && n > entry.max) {
          errors[entry.key] = t("settings.numberOutOfRange", { min: entry.min ?? 0, max: entry.max });
          continue;
        }
      }
    }
    return errors;
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validateAll();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const diff: Record<string, string> = {};
    for (const key of Object.keys(values)) {
      if (values[key] !== initial[key]) diff[key] = values[key];
    }
    if (Object.keys(diff).length === 0) {
      setIsEditing(false);
      return;
    }
    mutation.mutate(diff, {
      onSuccess: () => {
        setInitial(values);
        setIsEditing(false);
        toast.success({ title: t("settings.saveSuccess", { defaultValue: "Settings saved" }) });
      },
      onError: (error) => {
        toast.error({
          title: t("errors.saveFailed"),
          description: error instanceof Error ? error.message : undefined,
        });
      },
    });
  }

  function fieldLabel(entry: EditableSettingEntry): string {
    return t(`settings.fields.${entry.key}` as const, { defaultValue: entry.key });
  }

  function readonlyDisplay(entry: EditableSettingEntry, raw: string): string {
    if (entry.kind === "boolean") return raw === "true" ? t("settings.boolean.on") : t("settings.boolean.off");
    if (entry.kind === "enum") {
      // Map enum codes to localized labels via `settings.<i18nNamespace>.<value>`;
      // fall back to the raw value when the entry has no namespace or the key is missing.
      // 通过 `settings.<i18nNamespace>.<value>` 取本地化标签; 没声明命名空间或缺 key 时回退原值.
      const ns = entry.i18nNamespace;
      const path = ns ? `settings.${ns}.${raw}` : raw;
      return t(path as never, { defaultValue: raw });
    }
    return raw || t("settings.valuePlaceholder");
  }

  const version = query.data?.settings.version;
  const body = (
    <div className="settings-list">
      {editableSettingsSchema.map((entry) => {
        const error = fieldErrors[entry.key] ?? null;
        return (
          <div key={entry.key} className="settings-list-row">
            <div className="settings-list-label">{fieldLabel(entry)}</div>
            <div className="settings-list-value">
              {isEditing ? (
                <>
                  <InlineSettingField entry={entry} value={values[entry.key] ?? ""} onChange={(v) => setField(entry.key, v)} invalid={error !== null} />
                  {error ? <span className="settings-list-error" role="alert">{error}</span> : null}
                </>
              ) : (
                <span className="settings-list-readonly">{readonlyDisplay(entry, values[entry.key] ?? "")}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <h2>{t("settings.heading")}</h2>
        {isEditing ? null : (
          <Button type="button" variant="primary" onClick={startEditing}>
            {t("settings.editButton")}
          </Button>
        )}
      </div>
      {isEditing ? (
        <form className="settings-list-form" onSubmit={onSubmit} noValidate>
          {body}
          <div className="admin-form-actions admin-form-actions-inline">
            <Button type="button" variant="secondary" onClick={cancelEditing}>
              {t("formActions.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={mutation.isPending}>
              {mutation.isPending ? t("formActions.saving") : t("formActions.save")}
            </Button>
          </div>
        </form>
      ) : (
        body
      )}
      {version ? <p className="muted">{t("settings.version")}: {version}</p> : null}
    </section>
  );
}

// InlineSettingField renders the appropriate input widget for a single editable setting.
// The widget variant is chosen by entry.kind:
//   "boolean" → toggle checkbox  (stored as "true"/"false" string)
//   "enum"    → <Select>         (options sourced from entry.options)
//   "number"  → <input type=number> with optional min/max/step constraints
//   "url"|"text" → plain <input>
//
// The `invalid` flag toggles aria-invalid and data-invalid attributes so CSS can
// style the field without needing a class, keeping the logic in the schema layer.
//
// InlineSettingField
// 为单个可编辑配置项渲染合适的输入控件.
// 控件类型由 entry.kind 决定:
//   "boolean" → 切换复选框 (存储为 "true"/"false" 字符串)
//   "enum"    → <Select> (选项来自 entry.options)
//   "number"  → 带可选 min/max/step 约束的 <input type=number>
//   "url"|"text" → 普通 <input>
//
// invalid 标志切换 aria-invalid 和 data-invalid 属性, 让 CSS 无需额外 class 即可样式化错误字段,
// 将逻辑保留在 schema 层.
function InlineSettingField({
  entry,
  value,
  onChange,
  invalid,
}: {
  entry: EditableSettingEntry;
  value: string;
  onChange(value: string): void;
  invalid?: boolean;
}) {
  const { t } = useTranslation("admin");
  const invalidProps = invalid ? { "aria-invalid": true as const, "data-invalid": "true" } : {};
  switch (entry.kind) {
    case "boolean":
      return (
        <label className="form-toggle">
          <input
            type="checkbox"
            checked={value === "true"}
            onChange={(e) => onChange(e.target.checked ? "true" : "false")}
            aria-label={entry.key}
          />
          <span className="form-toggle-track" aria-hidden="true" />
          <span className="form-toggle-label">
            {value === "true" ? t("settings.boolean.on") : t("settings.boolean.off")}
          </span>
        </label>
      );
    case "enum": {
      const ns = entry.i18nNamespace;
      const opts = (entry.options ?? []).map((opt) => ({
        value: opt.value,
        label: ns
          ? t(`settings.${ns}.${opt.value}` as never, { defaultValue: opt.label })
          : opt.label,
      }));
      return <Select value={value} options={opts} onChange={onChange} ariaLabel={entry.key} />;
    }
    case "number":
      return (
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          min={entry.min}
          max={entry.max}
          step={entry.step}
          aria-label={entry.key}
          {...invalidProps}
        />
      );
    case "url":
    case "text":
    default:
      return <input value={value} onChange={(e) => onChange(e.target.value)} aria-label={entry.key} {...invalidProps} />;
  }
}
