// OptionalDate component tests — branching on hasUsableDate, placeholder vs formatted output.
// OptionalDate 组件测试 — hasUsableDate 分支、占位符与格式化输出.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OptionalDate } from "./OptionalDate";

describe("OptionalDate", () => {
  describe("when value is a valid timestamp", () => {
    it("renders a <span> with the formatted date string", () => {
      // Use a fixed UTC date to avoid local-timezone test fragility.
      // 使用固定 UTC 日期, 避免因时区不同导致测试结果不稳定.
      render(<OptionalDate value="2025-06-15T10:30:45Z" />);
      // The exact hour may differ by timezone; just assert date-cell class and year are present.
      // 精确小时可能因时区而异; 仅断言 date-cell 类和年份存在.
      const span = document.querySelector(".date-cell");
      expect(span).not.toBeNull();
      expect(span?.textContent).toMatch(/2025/);
    });

    it("does not render the placeholder class for a valid date", () => {
      render(<OptionalDate value="2025-06-15T10:30:45Z" />);
      expect(document.querySelector(".date-placeholder")).toBeNull();
    });

    it("applies the className prop alongside date-cell", () => {
      const { container } = render(<OptionalDate value="2025-06-15T10:30:45Z" className="col-date" />);
      const span = container.querySelector("span");
      expect(span?.classList.contains("date-cell")).toBe(true);
      expect(span?.classList.contains("col-date")).toBe(true);
    });
  });

  describe("when value is a Go zero-time", () => {
    it("renders the em-dash placeholder", () => {
      render(<OptionalDate value="0001-01-01T00:00:00Z" />);
      expect(screen.getByText("—")).toBeInTheDocument();
    });

    it("renders with date-placeholder class", () => {
      render(<OptionalDate value="0001-01-01T00:00:00Z" />);
      expect(document.querySelector(".date-placeholder")).not.toBeNull();
    });

    it("includes date-cell class alongside date-placeholder for consistent column width", () => {
      // Both branches must apply date-cell so table columns keep the same width.
      // 两个分支都应用 date-cell, 确保表格列宽一致.
      render(<OptionalDate value="0001-01-01T00:00:00Z" />);
      const span = document.querySelector(".date-cell");
      expect(span).not.toBeNull();
    });

    it("has an aria-label so screen readers say 'no date' not the em-dash glyph", () => {
      render(<OptionalDate value="0001-01-01T00:00:00Z" />);
      const span = document.querySelector(".date-placeholder");
      // The aria-label is set to the i18n key "date.missing" with defaultValue "no date".
      // aria-label 通过 i18n 键 "date.missing" 设置, 默认值 "no date".
      expect(span?.getAttribute("aria-label")).toBeTruthy();
    });

    it("applies className alongside date-cell and date-placeholder", () => {
      const { container } = render(<OptionalDate value="0001-01-01T00:00:00Z" className="col-date" />);
      const span = container.querySelector("span");
      expect(span?.classList.contains("date-cell")).toBe(true);
      expect(span?.classList.contains("date-placeholder")).toBe(true);
      expect(span?.classList.contains("col-date")).toBe(true);
    });
  });

  describe("when value is empty or invalid", () => {
    it("renders placeholder for empty string", () => {
      render(<OptionalDate value="" />);
      expect(document.querySelector(".date-placeholder")).not.toBeNull();
    });

    it("renders placeholder for non-date string", () => {
      render(<OptionalDate value="not-a-date" />);
      expect(document.querySelector(".date-placeholder")).not.toBeNull();
    });
  });
});
