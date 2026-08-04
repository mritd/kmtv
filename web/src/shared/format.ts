// Shared pure formatting helpers for durations, health tones, and optional dates.
// 共享纯函数: 格式化时长、健康状态色调和可选日期.
//
// These are pure and framework-free, so they cannot call useTranslation. That is the reason
// they return codes and placeholders rather than words: any human-readable text they produced
// would be a hardcoded translation. Callers hold the t() function and do the wording.
// 这些函数是纯函数且不依赖框架, 因此无法调用 useTranslation.
// 这正是它们返回码值与占位符而非文字的原因: 它们产出的任何可读文本都会是硬编码译文.
// 调用方持有 t() 函数, 由调用方决定措辞.
//
// Exports: Tone, formatDuration, sourceHealthTone, DATE_PLACEHOLDER, hasUsableDate,
//          formatDateTime, formatOptionalDate.
// Callers: shared/ui/StatusState, admin panels, OptionalDate component.

// Tone enumerates the semantic colour roles used by UI components.
// Tone 枚举 UI 组件使用的语义颜色角色.
export type Tone = "default" | "muted" | "success" | "danger" | "warning";

// formatDuration converts a millisecond number to a human-readable string.
// Absent or non-positive input yields DATE_PLACEHOLDER — a dash carries "no value" in any
// language, where the previous "未知" did not.
// formatDuration 将毫秒数转为可读字符串.
// 空值或非正数返回 DATE_PLACEHOLDER — 破折号在任何语言中都表示"无值",
// 而此前的 "未知" 做不到.
export function formatDuration(duration: number | undefined): string {
  if (!duration || duration <= 0) {
    return DATE_PLACEHOLDER;
  }
  if (duration < 1000) {
    return `${Math.round(duration)}ms`;
  }
  return `${(duration / 1000).toFixed(1)}s`;
}

// sourceHealthTone maps a backend health string to the semantic colour for its status pill.
// Any unrecognised value is "muted", the same tone as a source that has never been checked.
// sourceHealthTone 将后端健康状态字符串映射为状态标签的语义颜色.
// 未识别的值返回 "muted", 与从未检测过的来源同色.
//
// It returns only a tone: it used to return a Chinese label alongside it, which every caller
// discarded — SourcesPanel destructures the tone and takes its wording from t("status.*").
// 它只返回色调: 此前还会一并返回中文 label, 而所有调用方都将其丢弃 —
// SourcesPanel 只解构 tone, 文案取自 t("status.*").
export function sourceHealthTone(health: string): Tone {
  if (health === "healthy") {
    return "success";
  }
  if (health === "unhealthy") {
    return "danger";
  }
  if (health === "checking") {
    return "warning";
  }
  return "muted";
}

// DATE_PLACEHOLDER is the plain-text fallback for callers that need a string instead of the
// OptionalDate component; the rendered UI uses a single centered em-dash within a fixed-width cell.
// DATE_PLACEHOLDER
// 给需要纯字符串而非组件的调用方使用; 实际渲染由 OptionalDate 在等宽容器内居中显示 em-dash.
export const DATE_PLACEHOLDER = "—";

// hasUsableDate reports whether the timestamp string represents a real point in time.
// hasUsableDate
// 判断时间戳是否表达真实时刻; Go 零值 0001-01-01 视为缺失.
export function hasUsableDate(value: string): boolean {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  if (d.getUTCFullYear() <= 1) return false;
  return true;
}

// formatDateTime renders a stable YYYY/MM/DD HH:MM:SS string in local time.
// formatDateTime
// 渲染稳定的 YYYY/MM/DD HH:MM:SS 本地时间字符串.
export function formatDateTime(value: string): string {
  const d = new Date(value);
  const year = d.getFullYear().toString().padStart(4, "0");
  const month = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  const hour = d.getHours().toString().padStart(2, "0");
  const minute = d.getMinutes().toString().padStart(2, "0");
  const second = d.getSeconds().toString().padStart(2, "0");
  return `${year}/${month}/${day} ${hour}:${minute}:${second}`;
}

// formatOptionalDate returns the canonical date string or the placeholder template when missing.
// formatOptionalDate
// 缺值时返回与正常时间宽度一致的占位符模板.
export function formatOptionalDate(value: string): string {
  if (!hasUsableDate(value)) return DATE_PLACEHOLDER;
  return formatDateTime(value);
}
