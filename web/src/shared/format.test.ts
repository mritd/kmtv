import { describe, expect, it } from "vitest";

import { DATE_PLACEHOLDER, formatDateTime, formatDuration, formatOptionalDate, hasUsableDate, sourceHealthTone } from "./format";

describe("shared format helpers", () => {
  it("formats source durations", () => {
    // A dash, not a word: these helpers are pure and cannot reach useTranslation, so any
    //
    // wording they returned would be a hardcoded translation. This used to return "未知".
    //
    // 用破折号而非文字: 这些纯函数无法访问 useTranslation, 因此它们返回的任何措辞
    // 都会是硬编码译文. 此处此前返回 "未知".
    expect(formatDuration(undefined)).toBe(DATE_PLACEHOLDER);
    expect(formatDuration(0)).toBe(DATE_PLACEHOLDER);
    expect(formatDuration(412)).toBe("412ms");
    expect(formatDuration(1250)).toBe("1.3s");
  });

  it("maps source health to a tone and leaves the wording to the caller", () => {
    // Tone only. The previous shape bundled a Chinese label that every caller threw away —
    // SourcesPanel takes the tone and words it with t("status.*").
    //
    // 只返回色调. 此前的形态还捆绑了一个中文 label, 而所有调用方都会丢弃它 —
    // SourcesPanel 取用色调, 措辞交由 t("status.*").
    expect(sourceHealthTone("healthy")).toBe("success");
    expect(sourceHealthTone("unhealthy")).toBe("danger");
    expect(sourceHealthTone("checking")).toBe("warning");
    expect(sourceHealthTone("unknown")).toBe("muted");
    expect(sourceHealthTone("")).toBe("muted");
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
