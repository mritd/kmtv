/**
 * editableSettingsSchema — schema definitions for all admin-editable system settings.
 *
 * editableSettingsSchema — 所有管理员可编辑系统设置的 schema 定义.
 *
 * Responsibilities / 职责:
 *   - Enumerate each setting key with display metadata (kind, constraints); all text is i18n
 *
 *     以 kind/约束枚举每个设置项的展示元数据; 所有文案均走 i18n
 *
 *   - Expose validatePublicBaseURL mirroring backend ValidatePublicBaseURL
 *
 *     暴露与后端 ValidatePublicBaseURL 对等的前端校验函数
 *
 * Key exports / 主要导出:
 *   EditableSettingKind, EditableSettingEntry, editableSettingsSchema, validatePublicBaseURL
 *
 * Callers / 调用方:
 *   admin/SystemSettingsPanel.tsx
 *
 * Backend alignment / 后端对齐:
 *   Clamp ranges (min/max) mirror server/internal/runtime/settings.go clamp() calls:
 *     search_concurrency:  clamp(n, 1, 50)
 *     probe_concurrency:   clamp(n, 1, 50)
 *     probe_timeout:       clamp(n, 1, 20)
 *     search_timeout:      clamp(n, 1, 30)
 *   Token TTL lower-bound (min: 60) is enforced by the admin form only (no explicit backend clamp;
 *   backend accepts any positive integer via SetAccessTokenTTL / SetMediaTokenTTL).
 *   DO NOT change the four runtime clamp ranges without updating settings.go simultaneously.
 *
 *   四个运行时设置的 min/max 与 server/internal/runtime/settings.go 中的 clamp 调用一致:
 *     搜索并发 search_concurrency: clamp(n, 1, 50)
 *     探测并发 probe_concurrency: clamp(n, 1, 50)
 *     探测超时 probe_timeout: clamp(n, 1, 20)
 *     搜索超时 search_timeout: clamp(n, 1, 30)
 *   表单将 Token TTL 的下限设为 min: 60; 后端接受任意正整数.
 *   不得在未同步修改 settings.go 的情况下更改四个运行时 clamp 范围.
 */

/**
 * EditableSettingKind identifies the UI control type for a setting.
 *
 * EditableSettingKind 标识设置项对应的 UI 控件类型.
 */
export type EditableSettingKind = "text" | "number" | "boolean" | "url" | "enum";

/**
 * EditableSettingEntry describes a single editable setting in the admin UI.
 *
 * EditableSettingEntry 描述管理 UI 中单个可编辑设置项.
 *
 * `min` / `max` for number fields are enforced by the form input.
 * For the four runtime-concurrency/timeout keys (search_concurrency, probe_concurrency,
 * probe_timeout, search_timeout) the backend also clamps the value — ranges must stay aligned
 * with server/internal/runtime/settings.go. All other number fields (health_check_interval,
 * access_token_ttl, media_token_ttl) have form-only constraints.
 *
 * number 类型字段的 min/max 由表单输入执行.
 * 四个运行时并发/超时 key 后端也会 clamp — 范围须与 settings.go 保持对齐.
 * 其他 number 字段 (health_check_interval、access_token_ttl、media_token_ttl) 仅有表单层约束.
 *
 * `allowEmpty: true` means the field may be submitted as an empty string (e.g. public_base_url).
 *
 * allowEmpty: true 表示该字段可以提交为空字符串 (如 public_base_url).
 *
 * Entries intentionally contain no display labels. The panel resolves field labels from
 * t(`settings.fields.${key}`) and option labels from
 * t(`settings.<i18nNamespace>.<value>`), keeping the schema language-neutral.
 *
 * 条目刻意不包含展示标签. 面板通过 t(`settings.fields.${key}`) 获取字段标签,
 * 通过 t(`settings.<i18nNamespace>.<value>`) 获取选项标签, 使 schema 保持语言中立.
 */
export interface EditableSettingEntry {
  kind: EditableSettingKind;
  key: string;
  min?: number;
  max?: number;
  step?: number;
  options?: ReadonlyArray<{ value: string }>;
  // i18nNamespace points to the sub-tree under `admin.settings.*` that holds
  // option labels for this enum entry; falls back to the raw value when missing.
  //
  // i18nNamespace 指向 admin.settings.* 下存放 enum 选项标签的子树;
  // 命名空间或翻译缺失时回退到原始码值.
  i18nNamespace?: string;
  allowEmpty?: true;
}

/**
 * editableSettingsSchema is the authoritative list of settings the admin panel renders.
 *
 * editableSettingsSchema 是管理面板渲染的设置项权威列表.
 *
 * Clamp ranges are aligned with server/internal/runtime/settings.go — see module header.
 *
 * Clamp 范围与 server/internal/runtime/settings.go 保持对齐 — 参见模块头注释.
 */
export const editableSettingsSchema: ReadonlyArray<EditableSettingEntry> = [
  { kind: "text", key: "site_name" },
  { kind: "boolean", key: "anonymous_access" },
  { kind: "number", key: "health_check_interval", min: 60, step: 60 },
  // nsfw_filter_enabled is the site-wide NSFW filter: ON blocks NSFW for everyone;
  // OFF lets per-user allow_adult_content decide. Default ON, so NSFW is blocked by default.
  //
  // nsfw_filter_enabled 是全站 NSFW 过滤开关: 开启即对所有人屏蔽 NSFW;
  // 关闭则交由用户级 allow_adult_content 决定. 默认开启, 故默认屏蔽 NSFW.
  { kind: "boolean", key: "nsfw_filter_enabled" },
  {
    kind: "enum",
    key: "douban_image_proxy",
    i18nNamespace: "doubanImageProxy",
    options: [
      { value: "direct" },
      { value: "server" },
      { value: "tencent" },
      { value: "ali" },
    ],
  },
  // search_concurrency: backend clamp(n, 1, 50) in SetSearchConcurrency
  //
  // 后端 SetSearchConcurrency 执行 clamp(n, 1, 50)
  { kind: "number", key: "search_concurrency", min: 1, max: 50 },
  // probe_concurrency: backend clamp(n, 1, 50) in SetProbeConcurrency
  //
  // 后端 SetProbeConcurrency 执行 clamp(n, 1, 50)
  { kind: "number", key: "probe_concurrency", min: 1, max: 50 },
  // probe_timeout: backend clamp(n, 1, 20) in SetProbeTimeout
  //
  // 后端 SetProbeTimeout 执行 clamp(n, 1, 20)
  { kind: "number", key: "probe_timeout", min: 1, max: 20, step: 1 },
  // search_timeout: backend clamp(n, 1, 30) in SetSearchTimeout
  //
  // 后端 SetSearchTimeout 执行 clamp(n, 1, 30)
  { kind: "number", key: "search_timeout", min: 1, max: 30, step: 1 },
  { kind: "url", key: "public_base_url", allowEmpty: true },
  // access_token_ttl: min:60 is a form-level convention; backend accepts any positive int
  //
  // access_token_ttl: min:60 是表单层约定; 后端接受任何正整数
  { kind: "number", key: "access_token_ttl", min: 60 },
  // media_token_ttl: same convention as access_token_ttl
  //
  // media_token_ttl: 与 access_token_ttl 相同约定
  { kind: "number", key: "media_token_ttl", min: 60 },
  {
    kind: "enum",
    key: "playback_mode",
    i18nNamespace: "playbackMode",
    options: [
      { value: "direct" },
      { value: "proxy" },
    ],
  },
];

/**
 * validatePublicBaseURL mirrors server/internal/service/settings.go:ValidatePublicBaseURL.
 *
 * validatePublicBaseURL 镜像后端 ValidatePublicBaseURL 校验逻辑.
 *
 * Returns an error code string on invalid input, or `undefined` when valid (incl. empty).
 *
 * 输入无效时返回错误码字符串, 有效 (含空) 时返回 undefined.
 *
 * Error codes:
 *   "invalid" — not a parseable URL
 *   "scheme"  — scheme is not http or https
 *   "host"    — host is missing
 *   "extra"   — query string or fragment present
 *
 * 错误码:
 *   "invalid" — 无法解析 URL
 *   "scheme"  — scheme 不是 http 或 https
 *   "host"    — host 缺失
 *   "extra"   — 包含 query 或 fragment
 */
export function validatePublicBaseURL(raw: string): string | undefined {
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
