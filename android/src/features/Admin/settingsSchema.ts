// Editable system settings schema — ported from web/src/admin/forms/editableSettingsSchema.ts.
// 可编辑系统设置 schema, 从 web/src/admin/forms/editableSettingsSchema.ts 移植.
//
// Labels are pulled from i18n (admin.settings.labels.<key>), so the schema only carries
// kind + constraints + enum option i18n keys. Clamp ranges for the four runtime keys
// (search_concurrency, probe_concurrency, search_timeout, probe_timeout) must stay aligned
// with server/internal/runtime/settings.go.
// 标签从 i18n (admin.settings.labels.<key>) 读取, schema 仅承载 kind、约束与枚举选项的 i18n key.
// 四个运行时 clamp 范围须与 server/internal/runtime/settings.go 保持一致.

/**
 * EditableSettingKind identifies the UI control type for a setting.
 * EditableSettingKind 标识设置项对应的 UI 控件类型.
 */
export type EditableSettingKind = "text" | "number" | "boolean" | "url" | "enum";

/**
 * EditableSettingEntry describes a single editable setting in the admin UI.
 * EditableSettingEntry 描述管理 UI 中单个可编辑设置项.
 */
export interface EditableSettingEntry {
  kind: EditableSettingKind;
  key: string;
  min?: number;
  max?: number;
  step?: number;
  options?: ReadonlyArray<{ value: string; i18nKey: string }>;
  allowEmpty?: true;
}

/**
 * editableSettingsSchema — authoritative list of admin-editable keys.
 * editableSettingsSchema — 管理面板可编辑 key 的权威列表.
 */
export const editableSettingsSchema: ReadonlyArray<EditableSettingEntry> = [
  { kind: "text", key: "site_name" },
  { kind: "boolean", key: "anonymous_access" },
  { kind: "number", key: "health_check_interval", min: 60, step: 60 },
  { kind: "boolean", key: "nsfw_filter_enabled" },
  {
    kind: "enum",
    key: "douban_image_proxy",
    options: [
      { value: "direct", i18nKey: "settings.doubanImageProxy.direct" },
      { value: "server", i18nKey: "settings.doubanImageProxy.server" },
      { value: "tencent", i18nKey: "settings.doubanImageProxy.tencent" },
      { value: "ali", i18nKey: "settings.doubanImageProxy.ali" },
    ],
  },
  { kind: "number", key: "search_concurrency", min: 1, max: 50 },
  { kind: "number", key: "probe_concurrency", min: 1, max: 50 },
  { kind: "number", key: "probe_timeout", min: 1, max: 20, step: 1 },
  { kind: "number", key: "search_timeout", min: 1, max: 30, step: 1 },
  { kind: "url", key: "public_base_url", allowEmpty: true },
  { kind: "number", key: "access_token_ttl", min: 60 },
  { kind: "number", key: "media_token_ttl", min: 60 },
  {
    kind: "enum",
    key: "playback_mode",
    options: [
      { value: "direct", i18nKey: "settings.playbackMode.direct" },
      { value: "proxy", i18nKey: "settings.playbackMode.proxy" },
    ],
  },
];

/**
 * validatePublicBaseURL mirrors server/internal/service/settings.go:ValidatePublicBaseURL.
 * validatePublicBaseURL 镜像后端 ValidatePublicBaseURL 校验逻辑.
 *
 * Returns an error code on invalid input, or undefined when valid (including empty).
 * 无效时返回错误码, 有效 (含空) 返回 undefined.
 */
export function validatePublicBaseURL(raw: string): "invalid" | "scheme" | "host" | "extra" | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "invalid";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "scheme";
  if (!parsed.host) return "host";
  if (parsed.search || parsed.hash) return "extra";
  return undefined;
}

/**
 * clampNumber clamps `n` to [min, max] inclusive when bounds are present.
 * clampNumber 在 min/max 存在时将 n 截断到 [min, max] 闭区间.
 */
export function clampNumber(n: number, min?: number, max?: number): number {
  let v = n;
  if (typeof min === "number" && v < min) v = min;
  if (typeof max === "number" && v > max) v = max;
  return v;
}

/**
 * diffSettings returns only the entries in `next` that differ from `prev`.
 * diffSettings 仅返回 next 与 prev 中存在差异的字段.
 */
export function diffSettings(prev: Record<string, string>, next: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(next)) {
    if (prev[k] !== next[k]) out[k] = next[k]!;
  }
  return out;
}
