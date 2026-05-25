// OptionalDate — renders a formatted date string or a centered em-dash placeholder for missing dates.
// OptionalDate — 渲染格式化日期字符串, 或在日期缺失时渲染居中 em-dash 占位符.
//
// Exports: OptionalDate, OptionalDateProps.
// Callers: admin panels (source/subscription tables), any list that shows optional timestamps.
// 调用者: 管理面板 (源/订阅表格) 及其他展示可选时间戳的列表.
//
// Behaviour:
//   • Delegates the "is this a real date?" test to hasUsableDate from shared/format.
//     The Go backend emits "0001-01-01T00:00:00Z" for zero values; hasUsableDate rejects year ≤ 1.
//   • When no usable date: renders a <span> with class "date-placeholder" and an aria-label
//     so screen readers say "no date" instead of announcing the em-dash character.
//   • When a usable date: renders a <span> with class "date-cell" and a YYYY/MM/DD HH:MM:SS string.
//   • Both branches apply the className prop so column alignment is consistent regardless of state.
// 行为:
//   • 将 "这是真实日期吗?" 的判断委托给 shared/format 的 hasUsableDate.
//     Go 后端对零值返回 "0001-01-01T00:00:00Z"; hasUsableDate 拒绝年份 ≤ 1 的值.
//   • 无有效日期时: 渲染带 "date-placeholder" 类和 aria-label 的 <span>,
//     屏幕阅读器播报 "no date" 而非 em-dash 字符.
//   • 有有效日期时: 渲染带 "date-cell" 类和 YYYY/MM/DD HH:MM:SS 字符串的 <span>.
//   • 两个分支均应用 className, 保证列对齐与状态无关.

import { useTranslation } from "react-i18next";

import { formatDateTime, hasUsableDate } from "@/shared/format";

// Centered em-dash reads as "no value" without competing visually with real timestamps.
// Using a single character keeps the cell the same visual weight as a real date string
// would have in a fixed-width context.
// 居中的 em-dash 表达 "无值", 与真实时间字符串视觉对齐但不抢主体注意力.
const PLACEHOLDER_GLYPH = "—";

// OptionalDateProps defines the public API of OptionalDate.
// OptionalDateProps 定义 OptionalDate 的公开 API.
export interface OptionalDateProps {
  // value is the raw timestamp string from the backend (ISO 8601 or Go zero value).
  // value 是后端返回的原始时间戳字符串 (ISO 8601 或 Go 零值).
  value: string;
  className?: string;
}

// OptionalDate renders a formatted local date/time when value is a real timestamp, or an
// accessible em-dash placeholder when the value is absent or a Go zero-time.
// OptionalDate 在 value 为真实时间戳时渲染本地格式化日期; 否则渲染可访问的 em-dash 占位符.
export function OptionalDate({ value, className }: OptionalDateProps): React.JSX.Element {
  const { t } = useTranslation("common");

  if (!hasUsableDate(value)) {
    return (
      <span
        className={["date-cell", "date-placeholder", className].filter(Boolean).join(" ")}
        aria-label={t("date.missing", { defaultValue: "no date" })}
      >
        {PLACEHOLDER_GLYPH}
      </span>
    );
  }
  return (
    <span className={["date-cell", className].filter(Boolean).join(" ")}>
      {formatDateTime(value)}
    </span>
  );
}
