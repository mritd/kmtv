/**
 * EpisodePicker tests — selection UI for a flat episode list.
 * EpisodePicker 测试 — 平铺集数列表的选择 UI.
 *
 * Covers: empty list, rendering, current-item highlight, click selects, index boundary.
 * 覆盖: 空列表、渲染、当前项高亮、点击选择、索引边界.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Episode } from "@/api/types";

import { EpisodePicker } from "./EpisodePicker";

const episodes: Episode[] = [
  { name: "01", url: "https://cdn.example/1.m3u8" },
  { name: "02", url: "https://cdn.example/2.m3u8" },
  { name: "03", url: "https://cdn.example/3.m3u8" },
];

describe("EpisodePicker", () => {
  describe("when episodes list is empty", () => {
    it("renders the section with an empty grid and no buttons", () => {
      render(<EpisodePicker episodes={[]} selectedIndex={0} onSelect={vi.fn()} />);

      // Section and heading always render; absence of buttons confirms the empty path.
      // 区块和标题始终渲染; 无按钮证实空列表路径.
      expect(screen.getByRole("heading", { name: "选集" })).toBeInTheDocument();
      expect(screen.queryAllByRole("button")).toHaveLength(0);
    });
  });

  describe("when episodes are present", () => {
    it("renders one button per episode", () => {
      render(<EpisodePicker episodes={episodes} selectedIndex={0} onSelect={vi.fn()} />);

      expect(screen.getAllByRole("button")).toHaveLength(3);
      expect(screen.getByRole("button", { name: "播放 01" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "播放 02" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "播放 03" })).toBeInTheDocument();
    });

    it("highlights the currently selected episode with the active class", () => {
      render(<EpisodePicker episodes={episodes} selectedIndex={1} onSelect={vi.fn()} />);

      expect(screen.getByRole("button", { name: "播放 01" })).not.toHaveClass("active");
      expect(screen.getByRole("button", { name: "播放 02" })).toHaveClass("active");
      expect(screen.getByRole("button", { name: "播放 03" })).not.toHaveClass("active");
    });

    it("calls onSelect with the correct index and episode when a button is clicked", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(<EpisodePicker episodes={episodes} selectedIndex={0} onSelect={onSelect} />);

      await user.click(screen.getByRole("button", { name: "播放 02" }));

      expect(onSelect).toHaveBeenCalledOnce();
      expect(onSelect).toHaveBeenCalledWith(1, episodes[1]);
    });

    it("calls onSelect with index 0 when the first episode is clicked", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(<EpisodePicker episodes={episodes} selectedIndex={2} onSelect={onSelect} />);

      await user.click(screen.getByRole("button", { name: "播放 01" }));

      expect(onSelect).toHaveBeenCalledWith(0, episodes[0]);
    });

    it("uses episode name in aria-label so screen readers can identify episodes by name", () => {
      render(<EpisodePicker episodes={episodes} selectedIndex={0} onSelect={vi.fn()} />);

      // aria-label contains the episode name so assistive technology announces the episode.
      // aria-label 包含集数名称, 使辅助技术能够播报集数.
      expect(screen.getByRole("button", { name: "播放 03" })).toHaveAttribute("aria-label", "播放 03");
    });

    it("does not highlight any button when selectedIndex is out of bounds", () => {
      // selectedIndex may momentarily exceed the episode count when switching sources.
      // 切换来源时 selectedIndex 可能短暂超出集数数量.
      render(<EpisodePicker episodes={episodes} selectedIndex={99} onSelect={vi.fn()} />);

      const buttons = screen.getAllByRole("button");
      for (const button of buttons) {
        expect(button).not.toHaveClass("active");
      }
    });
  });
});
