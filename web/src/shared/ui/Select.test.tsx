// Tests for the Select custom dropdown component.
// Select 自定义下拉组件测试.
//
// Coverage targets: happy path + disabled + keyboard navigation + empty options edge case.
// 覆盖目标: 正常路径 + 禁用 + 键盘导航 + 空选项边界.

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Select } from "./Select";
import type { SelectOption } from "./Select";

const OPTIONS: SelectOption[] = [
  { value: "a", label: "Option A" },
  { value: "b", label: "Option B" },
  { value: "c", label: "Option C" },
];

describe("Select", () => {
  describe("happy path — open, select, close", () => {
    it("renders the currently selected option label in the trigger", () => {
      render(<Select value="b" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick one" />);
      expect(screen.getByRole("button", { name: /Pick one/i })).toBeInTheDocument();
      // The trigger label span should show the selected option's label.
      // trigger label span 应显示当前选中项的文本.
      expect(screen.getByText("Option B")).toBeInTheDocument();
    });

    it("opens the listbox when the trigger is clicked", async () => {
      const user = userEvent.setup();
      render(<Select value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick one" />);
      expect(screen.queryByRole("listbox")).toBeNull();
      await user.click(screen.getByRole("button", { name: /Pick one/i }));
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    it("calls onChange with the chosen value when an option is clicked", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Select value="a" options={OPTIONS} onChange={onChange} ariaLabel="Pick one" />);
      await user.click(screen.getByRole("button", { name: /Pick one/i }));
      // Click "Option C" in the listbox.
      // 在列表框中点击 "Option C".
      await user.click(screen.getByRole("option", { name: /Option C/ }));
      expect(onChange).toHaveBeenCalledWith("c");
    });

    it("closes the listbox after a selection is made", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Select value="a" options={OPTIONS} onChange={onChange} ariaLabel="Pick one" />);
      await user.click(screen.getByRole("button", { name: /Pick one/i }));
      await user.click(screen.getByRole("option", { name: /Option B/ }));
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("marks the current value as aria-selected in the listbox", async () => {
      const user = userEvent.setup();
      render(<Select value="b" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick one" />);
      await user.click(screen.getByRole("button", { name: /Pick one/i }));
      const selected = screen.getByRole("option", { name: /Option B/ });
      expect(selected).toHaveAttribute("aria-selected", "true");
      const notSelected = screen.getByRole("option", { name: /Option A/ });
      expect(notSelected).toHaveAttribute("aria-selected", "false");
    });
  });

  describe("when disabled", () => {
    it("renders the trigger as disabled", () => {
      render(<Select value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick one" disabled />);
      const trigger = screen.getByRole("button", { name: /Pick one/i });
      expect(trigger).toBeDisabled();
    });

    it("does not open the listbox when a disabled trigger is clicked", async () => {
      const user = userEvent.setup();
      render(<Select value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick one" disabled />);
      // Clicking a disabled button has no effect in the browser.
      // 浏览器中点击禁用按钮不触发 click 事件.
      await user.click(screen.getByRole("button", { name: /Pick one/i }));
      expect(screen.queryByRole("listbox")).toBeNull();
    });
  });

  describe("keyboard navigation", () => {
    it("opens with ArrowDown key and navigates down", async () => {
      const user = userEvent.setup();
      render(<Select value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick one" />);
      const trigger = screen.getByRole("button", { name: /Pick one/i });
      trigger.focus();
      await user.keyboard("{ArrowDown}");
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    it("opens with Enter key", async () => {
      const user = userEvent.setup();
      render(<Select value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick one" />);
      const trigger = screen.getByRole("button", { name: /Pick one/i });
      trigger.focus();
      await user.keyboard("{Enter}");
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    it("closes the listbox on Escape and returns focus to the trigger", async () => {
      const user = userEvent.setup();
      render(<Select value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick one" />);
      await user.click(screen.getByRole("button", { name: /Pick one/i }));
      expect(screen.getByRole("listbox")).toBeInTheDocument();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("listbox")).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: /Pick one/i }));
    });

    it("navigates options with ArrowDown / ArrowUp in the panel", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Select value="a" options={OPTIONS} onChange={onChange} ariaLabel="Pick one" />);
      const trigger = screen.getByRole("button", { name: /Pick one/i });
      trigger.focus();
      // Open with ArrowDown.
      // 用方向键打开.
      await user.keyboard("{ArrowDown}");
      const panel = screen.getByRole("listbox");
      // ArrowDown moves activeIndex from 0 → 1.
      // ArrowDown 将活跃索引从 0 移动到 1.
      fireEvent.keyDown(panel, { key: "ArrowDown" });
      // Confirm option B now has is-active class.
      // 确认 Option B 获得 is-active 样式.
      expect(screen.getByRole("option", { name: /Option B/ })).toHaveClass("is-active");
      // ArrowUp moves back to 0.
      // ArrowUp 移回索引 0.
      fireEvent.keyDown(panel, { key: "ArrowUp" });
      expect(screen.getByRole("option", { name: /Option A/ })).toHaveClass("is-active");
    });

    it("selects the active option on Enter in the panel and closes", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Select value="a" options={OPTIONS} onChange={onChange} ariaLabel="Pick one" />);
      const trigger = screen.getByRole("button", { name: /Pick one/i });
      trigger.focus();
      await user.keyboard("{ArrowDown}");
      const panel = screen.getByRole("listbox");
      // Move to Option B.
      // 移动到 Option B.
      fireEvent.keyDown(panel, { key: "ArrowDown" });
      fireEvent.keyDown(panel, { key: "Enter" });
      expect(onChange).toHaveBeenCalledWith("b");
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("wraps ArrowDown from last to first option", async () => {
      const user = userEvent.setup();
      render(<Select value="c" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick one" />);
      const trigger = screen.getByRole("button", { name: /Pick one/i });
      trigger.focus();
      await user.keyboard("{ArrowDown}");
      const panel = screen.getByRole("listbox");
      // value="c" → selectedIndex=2 → activeIndex starts at 2.
      // 初始活跃索引为 2 (Option C).
      // ArrowDown from index 2 wraps to 0.
      // 从索引 2 向下循环回 0.
      fireEvent.keyDown(panel, { key: "ArrowDown" });
      expect(screen.getByRole("option", { name: /Option A/ })).toHaveClass("is-active");
    });

    it("jumps to first / last with Home / End keys", async () => {
      const user = userEvent.setup();
      render(<Select value="b" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick one" />);
      const trigger = screen.getByRole("button", { name: /Pick one/i });
      trigger.focus();
      await user.keyboard("{ArrowDown}");
      const panel = screen.getByRole("listbox");
      fireEvent.keyDown(panel, { key: "End" });
      expect(screen.getByRole("option", { name: /Option C/ })).toHaveClass("is-active");
      fireEvent.keyDown(panel, { key: "Home" });
      expect(screen.getByRole("option", { name: /Option A/ })).toHaveClass("is-active");
    });
  });

  describe("activeIndex stability on mid-open value change (F2)", () => {
    it("does not reset activeIndex when parent re-renders with a new value while panel is open", async () => {
      // Bug: selectedIndex is in the useEffect dep array; a parent re-render with a new value
      // causes the effect to re-run and snap activeIndex back to the new selection, discarding
      // the user's in-progress keyboard navigation.
      // 缺陷: selectedIndex 在 useEffect 依赖中; 父组件更新 value 导致 effect 重跑,
      // 将 activeIndex 强制重置为新选中项, 丢弃用户正在进行的键盘导航.
      const user = userEvent.setup();
      const onChange = vi.fn();
      const { rerender } = render(
        <Select value="a" options={OPTIONS} onChange={onChange} ariaLabel="Pick one" />,
      );
      const trigger = screen.getByRole("button", { name: /Pick one/i });
      trigger.focus();
      // Open with ArrowDown — activeIndex initialises to selectedIndex (0 for "a").
      // 方向下键打开 — activeIndex 初始化为 selectedIndex (0, 对应 "a").
      await user.keyboard("{ArrowDown}");
      const panel = screen.getByRole("listbox");
      // Advance activeIndex once: 0 → 1 (Option B at index 1).
      // 向下移动一次: 0 → 1 (Option B 在索引 1).
      fireEvent.keyDown(panel, { key: "ArrowDown" });
      expect(screen.getByRole("option", { name: /Option B/ })).toHaveClass("is-active");

      // Parent re-renders with value="c" (selectedIndex=2) while user is on Option B (activeIndex=1).
      // With the bug, this re-runs the effect and snaps activeIndex to 2, discarding user navigation.
      // 父组件传入 value="c" (selectedIndex=2) 重渲染, 而用户光标在 Option B (activeIndex=1).
      // 有缺陷时 effect 重跑, 将 activeIndex 强制跳到 2, 丢弃用户导航位置.
      rerender(<Select value="c" options={OPTIONS} onChange={onChange} ariaLabel="Pick one" />);
      // Panel must still be open and Option B must still be active — NOT reset to Option C.
      // 面板仍应开启, Option B 仍应为活跃项 — 不应重置为 Option C.
      expect(screen.queryByRole("listbox")).not.toBeNull();
      expect(screen.getByRole("option", { name: /Option B/ })).toHaveClass("is-active");
      expect(screen.getByRole("option", { name: /Option C/ })).not.toHaveClass("is-active");
    });

    it("resets activeIndex to the new selection on a fresh open after value changes", async () => {
      // Confirm the open-reset still works correctly: close, update value, re-open → correct index.
      // 确认打开重置仍正确: 关闭后更新 value, 再次打开时光标回到新选中项.
      const user = userEvent.setup();
      const onChange = vi.fn();
      const { rerender } = render(
        <Select value="a" options={OPTIONS} onChange={onChange} ariaLabel="Pick one" />,
      );
      const trigger = screen.getByRole("button", { name: /Pick one/i });
      trigger.focus();
      await user.keyboard("{ArrowDown}");
      // Advance to Option B.
      // 移动到 Option B.
      fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });
      expect(screen.getByRole("option", { name: /Option B/ })).toHaveClass("is-active");
      // Close the panel.
      // 关闭面板.
      await user.keyboard("{Escape}");
      // Change value externally.
      // 外部更新 value.
      rerender(<Select value="c" options={OPTIONS} onChange={onChange} ariaLabel="Pick one" />);
      // Re-open — activeIndex should reset to selectedIndex of "c" (2).
      // 重新打开 — activeIndex 应重置为 "c" 的 selectedIndex (2).
      trigger.focus();
      await user.keyboard("{ArrowDown}");
      expect(screen.getByRole("option", { name: /Option C/ })).toHaveClass("is-active");
    });
  });

  describe("edge case — empty options list", () => {
    it("renders trigger without crashing when options is empty", () => {
      render(<Select value="" options={[]} onChange={vi.fn()} ariaLabel="Empty" />);
      expect(screen.getByRole("button", { name: /Empty/i })).toBeInTheDocument();
    });

    it("shows an empty listbox when options is empty", async () => {
      const user = userEvent.setup();
      render(<Select value="" options={[]} onChange={vi.fn()} ariaLabel="Empty" />);
      await user.click(screen.getByRole("button", { name: /Empty/i }));
      const listbox = screen.getByRole("listbox");
      expect(listbox).toBeInTheDocument();
      expect(screen.queryAllByRole("option")).toHaveLength(0);
    });
  });

  describe("click outside closes the listbox", () => {
    it("closes when clicking outside the component", async () => {
      const user = userEvent.setup();
      render(
        <div>
          <Select value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick one" />
          <button type="button">Outside</button>
        </div>,
      );
      await user.click(screen.getByRole("button", { name: /Pick one/i }));
      expect(screen.getByRole("listbox")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /Outside/i }));
      expect(screen.queryByRole("listbox")).toBeNull();
    });
  });
});
