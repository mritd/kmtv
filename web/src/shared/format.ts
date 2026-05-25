// Shared pure formatting helpers for durations, health labels, and optional dates.
// 共享纯函数: 格式化时长、健康状态标签和可选日期.
//
// Exports: Tone, formatDuration, formatSourceHealth, DATE_PLACEHOLDER, hasUsableDate,
//          formatDateTime, formatOptionalDate.
// Callers: shared/ui/StatusState, admin panels, OptionalDate component.

// Tone enumerates the semantic colour roles used by UI components.
// Tone 枚举 UI 组件使用的语义颜色角色.
export type Tone = "default" | "muted" | "success" | "danger" | "warning";

// formatDuration converts a millisecond number to a human-readable string.
// formatDuration 将毫秒数转为可读字符串; 空值或非正数返回"未知".
export function formatDuration(duration: number | undefined): string {
  if (!duration || duration <= 0) {
    return "未知";
  }
  if (duration < 1000) {
    return `${Math.round(duration)}ms`;
  }
  return `${(duration / 1000).toFixed(1)}s`;
}

// formatSourceHealth maps a backend health string to a localised label and tone.
// formatSourceHealth 将后端健康状态字符串映射为本地化标签和色调.
// Any unrecognised value falls through to the "未检测" muted default.
// 未识别的值默认返回"未检测" muted.
export function formatSourceHealth(health: string): { label: string; tone: Tone } {
  if (health === "healthy") {
    return { label: "正常", tone: "success" };
  }
  if (health === "unhealthy") {
    return { label: "异常", tone: "danger" };
  }
  if (health === "checking") {
    return { label: "检测中", tone: "warning" };
  }
  return { label: "未检测", tone: "muted" };
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
