/**
 * SourcePicker tests — source selection control with latency sorting and overflow collapse.
 * SourcePicker 测试 — 带延迟排序和溢出折叠的来源选择控件.
 *
 * Covers: empty list, rendering, current-item highlight, click selects, latencyLabel unit,
 *         sorting, overflow collapse/expand, aria-pressed contract.
 * 覆盖: 空列表、渲染、当前项高亮、点击选择、latencyLabel 单元测试、
 *       排序、溢出折叠/展开、aria-pressed 契约.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { latencyLabel, SourcePicker, type SourcePickerItem } from "./SourcePicker";

// Minimal two-source fixture.
// 最小双来源测试夹具.
const twoSources: SourcePickerItem[] = [
  { key: "source-a", name: "Source A", durationMs: 800, status: "ready" },
  { key: "source-b", name: "Source B", durationMs: 2000, status: "idle" },
];

describe("latencyLabel", () => {
  it("returns the unknown class and label when durationMs is undefined", () => {
    expect(latencyLabel(undefined, "未知")).toEqual({ label: "未知", className: "source-latency-unknown" });
  });

  it("returns the unknown class when durationMs is zero", () => {
    expect(latencyLabel(0, "未知")).toEqual({ label: "未知", className: "source-latency-unknown" });
  });

  it("returns the unknown class when durationMs is negative", () => {
    // Negative values are treated as invalid/unknown.
    // 负值视为无效/未知.
    expect(latencyLabel(-1, "未知")).toEqual({ label: "未知", className: "source-latency-unknown" });
  });

  it("formats sub-second latency in ms with the good class", () => {
    expect(latencyLabel(412, "未知")).toEqual({ label: "412ms", className: "source-latency-good" });
  });

  it("rounds sub-second latency to the nearest integer ms", () => {
    expect(latencyLabel(412.7, "未知")).toEqual({ label: "413ms", className: "source-latency-good" });
  });

  it("formats 1-3 second latency in seconds with the warn class", () => {
    expect(latencyLabel(1200, "未知")).toEqual({ label: "1.2s", className: "source-latency-warn" });
  });

  it("formats latency >= 3 seconds with the bad class", () => {
    expect(latencyLabel(3600, "未知")).toEqual({ label: "3.6s", className: "source-latency-bad" });
  });

  it("treats exactly 1000 ms as warn tier", () => {
    // Boundary: 1000 ms is exactly 1 s, which maps to warn (1 <= x < 3).
    // 边界: 1000ms 恰好为 1s, 映射到 warn (1 <= x < 3).
    expect(latencyLabel(1000, "未知")).toEqual({ label: "1.0s", className: "source-latency-warn" });
  });

  it("treats exactly 3000 ms as bad tier", () => {
    // Boundary: 3000 ms is exactly 3 s, which maps to bad (x >= 3).
    // 边界: 3000ms 恰好为 3s, 映射到 bad (x >= 3).
    expect(latencyLabel(3000, "未知")).toEqual({ label: "3.0s", className: "source-latency-bad" });
  });
});

describe("SourcePicker", () => {
  describe("when sources list is empty", () => {
    it("renders the heading with an empty picker and no buttons", () => {
      render(<SourcePicker sources={[]} selectedKey="" onSelect={vi.fn()} />);

      expect(screen.getByRole("heading", { name: "视频源" })).toBeInTheDocument();
      expect(screen.queryAllByRole("button")).toHaveLength(0);
    });
  });

  describe("when sources are present", () => {
    it("renders one button per source with its name and latency label", () => {
      render(<SourcePicker sources={twoSources} selectedKey="source-a" onSelect={vi.fn()} />);

      expect(screen.getByRole("button", { name: "Source A · 800ms" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Source B · 2.0s" })).toBeInTheDocument();
    });

    it("marks the selected source with aria-pressed=true and the active class", () => {
      render(<SourcePicker sources={twoSources} selectedKey="source-b" onSelect={vi.fn()} />);

      expect(screen.getByRole("button", { name: "Source A · 800ms" })).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("button", { name: "Source B · 2.0s" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Source B · 2.0s" })).toHaveClass("active");
    });

    it("calls onSelect with the clicked source key", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(<SourcePicker sources={twoSources} selectedKey="source-a" onSelect={onSelect} />);

      await user.click(screen.getByRole("button", { name: "Source B · 2.0s" }));

      expect(onSelect).toHaveBeenCalledOnce();
      expect(onSelect).toHaveBeenCalledWith("source-b");
    });

    it("sorts sources by latency fastest-first, placing unknown-latency sources last", () => {
      const sources: SourcePickerItem[] = [
        { key: "slow", name: "Slow", durationMs: 5000, status: "ready" },
        { key: "unknown", name: "Unknown", status: "idle" },
        { key: "fast", name: "Fast", durationMs: 200, status: "ready" },
        { key: "medium", name: "Medium", durationMs: 2000, status: "ready" },
      ];
      render(<SourcePicker sources={sources} selectedKey="fast" onSelect={vi.fn()} />);

      const buttons = screen.getAllByRole("button").filter((b) => b.classList.contains("source-button"));
      // Expected order: Fast (200ms) → Medium (2.0s) → Slow (5.0s) → Unknown.
      // 预期顺序: Fast (200ms) → Medium (2.0s) → Slow (5.0s) → Unknown.
      expect(buttons[0]).toHaveAccessibleName("Fast · 200ms");
      expect(buttons[1]).toHaveAccessibleName("Medium · 2.0s");
      expect(buttons[2]).toHaveAccessibleName("Slow · 5.0s");
      expect(buttons[3]).toHaveAccessibleName("Unknown · 未知");
    });

    it("shows an unknown latency badge for sources with no durationMs", () => {
      const sources: SourcePickerItem[] = [
        { key: "no-ms", name: "No MS", status: "idle" },
      ];
      render(<SourcePicker sources={sources} selectedKey="" onSelect={vi.fn()} />);

      expect(screen.getByText("未知")).toHaveClass("source-latency-unknown");
    });
  });

  describe("overflow collapse (more than 8 sources)", () => {
    // Build 10 sources with stable latency so sort order is deterministic.
    // 构建 10 个延迟稳定的来源以保证排序确定性.
    const manySources: SourcePickerItem[] = Array.from({ length: 10 }, (_, i) => ({
      key: `source-${i + 1}`,
      name: `Source ${i + 1}`,
      durationMs: 100 + i,
      status: "ready" as const,
    }));

    it("collapses items beyond the first 8 and shows a toggle", () => {
      render(<SourcePicker sources={manySources} selectedKey="source-1" onSelect={vi.fn()} />);

      expect(screen.getByRole("button", { name: "Source 8 · 107ms" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Source 9 · 108ms" })).toBeNull();
      expect(screen.getByRole("button", { name: "显示更多" })).toBeInTheDocument();
    });

    it("expands all items when the toggle is clicked", async () => {
      const user = userEvent.setup();
      render(<SourcePicker sources={manySources} selectedKey="source-1" onSelect={vi.fn()} />);

      await user.click(screen.getByRole("button", { name: "显示更多" }));

      expect(screen.getByRole("button", { name: "Source 9 · 108ms" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Source 10 · 109ms" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "收起" })).toBeInTheDocument();
    });

    it("re-collapses items when the collapse toggle is clicked", async () => {
      const user = userEvent.setup();
      render(<SourcePicker sources={manySources} selectedKey="source-1" onSelect={vi.fn()} />);

      await user.click(screen.getByRole("button", { name: "显示更多" }));
      await user.click(screen.getByRole("button", { name: "收起" }));

      expect(screen.queryByRole("button", { name: "Source 9 · 108ms" })).toBeNull();
      expect(screen.getByRole("button", { name: "显示更多" })).toBeInTheDocument();
    });

    it("does not show the toggle when exactly 8 sources are present", () => {
      const eightSources = manySources.slice(0, 8);
      render(<SourcePicker sources={eightSources} selectedKey="source-1" onSelect={vi.fn()} />);

      expect(screen.queryByRole("button", { name: "显示更多" })).toBeNull();
      expect(screen.queryByRole("button", { name: "收起" })).toBeNull();
      // All 8 source buttons are visible.
      // 全部 8 个来源按钮可见.
      expect(screen.getAllByRole("button").filter((b) => b.classList.contains("source-button"))).toHaveLength(8);
    });
  });
});
