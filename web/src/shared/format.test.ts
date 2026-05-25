import { describe, expect, it } from "vitest";

import { DATE_PLACEHOLDER, formatDateTime, formatDuration, formatOptionalDate, formatSourceHealth, hasUsableDate } from "./format";

describe("shared format helpers", () => {
  it("formats source durations", () => {
    expect(formatDuration(undefined)).toBe("未知");
    expect(formatDuration(412)).toBe("412ms");
    expect(formatDuration(1250)).toBe("1.3s");
  });

  it("formats source health labels", () => {
    expect(formatSourceHealth("healthy")).toEqual({ label: "正常", tone: "success" });
    expect(formatSourceHealth("unhealthy")).toEqual({ label: "异常", tone: "danger" });
    expect(formatSourceHealth("checking")).toEqual({ label: "检测中", tone: "warning" });
    expect(formatSourceHealth("unknown")).toEqual({ label: "未检测", tone: "muted" });
  });

  it("treats Go zero-time and empty as missing", () => {
    expect(hasUsableDate("")).toBe(false);
    expect(hasUsableDate("0001-01-01T00:00:00Z")).toBe(false);
    expect(hasUsableDate("not a date")).toBe(false);
    expect(hasUsableDate("2026-05-16T00:00:00Z")).toBe(true);
  });

  it("renders fixed YYYY/MM/DD HH:MM:SS for known dates", () => {
    const formatted = formatDateTime("2026-05-16T10:23:45Z");
    expect(formatted).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("returns the placeholder glyph when date is missing", () => {
    expect(DATE_PLACEHOLDER).toBe("—");
    expect(formatOptionalDate("")).toBe(DATE_PLACEHOLDER);
    expect(formatOptionalDate("0001-01-01T08:05:43Z")).toBe(DATE_PLACEHOLDER);
    expect(formatOptionalDate("2026-05-16T00:00:00Z")).toContain("2026");
  });
});
