// Tests for the FocusTrap focus management component.
// FocusTrap 焦点管理组件测试.
//
// Coverage targets: initial focus, Tab wrap (forward), Shift+Tab wrap (backward), focus restoration on unmount.
// 覆盖目标: 初始焦点、Tab 循环(正向)、Shift+Tab 循环(反向)、卸载时焦点恢复.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FocusTrap } from "./FocusTrap";

describe("FocusTrap", () => {
  describe("initial focus on mount", () => {
    it("moves focus to the first focusable element inside the trap", () => {
      render(
        <FocusTrap>
          <button type="button">First</button>
          <button type="button">Second</button>
        </FocusTrap>,
      );
      // The trap should auto-focus the first focusable element so users can interact immediately.
      // Trap 应自动聚焦首个可聚焦元素, 使用户可立即交互.
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
    });

    it("prefers [autofocus] element over the first focusable element", () => {
      render(
        <FocusTrap>
          <button type="button">First</button>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <button type="button" autoFocus>
            Auto
          </button>
        </FocusTrap>,
      );
      // [autofocus] takes priority to honour the designer's intent.
      // [autofocus] 优先以尊重设计意图.
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Auto" }));
    });
  });

  describe("Tab wrapping", () => {
    it("wraps Tab from the last focusable element back to the first", () => {
      render(
        <FocusTrap>
          <button type="button">First</button>
          <button type="button">Second</button>
        </FocusTrap>,
      );
      const [first, second] = screen.getAllByRole("button");
      second.focus();
      expect(document.activeElement).toBe(second);
      // Tab on the last element should wrap to the first — focus must not escape.
      // 在最后一个元素按 Tab 应循环回首个 — 焦点不得逃逸.
      fireEvent.keyDown(document, { key: "Tab", shiftKey: false });
      expect(document.activeElement).toBe(first);
    });

    it("wraps Shift+Tab from the first focusable element back to the last", () => {
      render(
        <FocusTrap>
          <button type="button">First</button>
          <button type="button">Second</button>
        </FocusTrap>,
      );
      const [first, second] = screen.getAllByRole("button");
      first.focus();
      // Shift+Tab on the first element should wrap to the last — focus must not escape.
      // 在首个元素按 Shift+Tab 应循环到末尾 — 焦点不得逃逸.
      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(second);
    });

    it("does not intercept Tab when focus is on a middle element", () => {
      render(
        <FocusTrap>
          <button type="button">First</button>
          <button type="button">Middle</button>
          <button type="button">Last</button>
        </FocusTrap>,
      );
      const middle = screen.getByRole("button", { name: "Middle" });
      middle.focus();
      // Tab from a middle element is handled by the browser naturally — trap should not interfere.
      // 从中间元素 Tab 由浏览器自然处理 — trap 不应干预.
      fireEvent.keyDown(document, { key: "Tab", shiftKey: false });
      // Focus remains on "Middle" because fireEvent does not implement real browser Tab behaviour;
      // the important assertion is that the trap did not forcibly move it somewhere unexpected.
      // fireEvent 不模拟真实 Tab 行为, 焦点仍在 middle; 重要的是 trap 未强制移动它.
      expect(document.activeElement).toBe(middle);
    });
  });

  describe("focus restoration on unmount", () => {
    it("returns focus to the element that was focused before the trap mounted", () => {
      const trigger = document.createElement("button");
      trigger.textContent = "Open";
      document.body.appendChild(trigger);
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      const { unmount } = render(
        <FocusTrap>
          <button type="button">Inside</button>
        </FocusTrap>,
      );

      // Focus is now inside the trap.
      // 焦点现在在 trap 内部.
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Inside" }));

      unmount();

      // After unmount, focus must return to the original trigger element.
      // 卸载后焦点必须返还给原始触发元素.
      expect(document.activeElement).toBe(trigger);
      document.body.removeChild(trigger);
    });

    it("restores focus to the trigger even when a child uses React autoFocus", () => {
      // Regression for the React-autoFocus bug: when autoFocus fires before the useEffect runs,
      // document.activeElement at effect time is already the child. The trap must NOT record
      // that child as the "previous owner" — it must still restore to the outer trigger on unmount.
      // 回归测试: React autoFocus 在 useEffect 前触发时, effect 运行时 activeElement 已是子节点.
      // trap 不应将该子节点记为"前一个持有者", 卸载时仍应恢复到外部触发元素.
      const trigger = document.createElement("button");
      trigger.textContent = "Open";
      document.body.appendChild(trigger);
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      const { unmount } = render(
        <FocusTrap>
          <button type="button">First</button>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <button type="button" autoFocus>
            Auto
          </button>
        </FocusTrap>,
      );

      // React autoFocus should have moved focus to "Auto" before the trap's useEffect ran.
      // React autoFocus 在 trap 的 useEffect 运行前已将焦点移至 "Auto".
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Auto" }));

      unmount();

      // Focus must be restored to the external trigger, not the now-unmounted "Auto" child.
      // 焦点必须恢复到外部触发元素, 而不是已卸载的 "Auto" 子节点.
      expect(document.activeElement).toBe(trigger);
      document.body.removeChild(trigger);
    });
  });

  describe("restore-target guard for detached node (F3)", () => {
    it("does not call focus() on the restore target if it has been removed from the DOM", () => {
      // Bug: restoreTargetRef.current?.focus() runs unconditionally on unmount.
      // If the captured element is removed from the DOM before the trap unmounts,
      // focus() silently no-ops and focus is lost. Guard: only call focus() when document.contains.
      // 缺陷: 卸载时无条件调用 restoreTargetRef.current?.focus().
      // 若捕获的元素在 trap 卸载前已从 DOM 移除, focus() 静默无操作且焦点丢失.
      // 修复: 仅在 document.contains 为 true 时调用 focus().
      const trigger = document.createElement("button");
      trigger.textContent = "Trigger";
      document.body.appendChild(trigger);
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      const focusSpy = vi.spyOn(trigger, "focus");

      const { unmount } = render(
        <FocusTrap>
          <button type="button">Inside</button>
        </FocusTrap>,
      );

      // Remove the trigger from the DOM before unmounting the trap.
      // 在 trap 卸载前将触发器从 DOM 移除.
      document.body.removeChild(trigger);
      expect(document.contains(trigger)).toBe(false);

      // Unmount the trap — focus() must NOT be called on the detached node.
      // 卸载 trap — 不应在已分离节点上调用 focus().
      unmount();
      expect(focusSpy).not.toHaveBeenCalled();
    });
  });

  describe("edge case — no focusable children", () => {
    it("does not throw and renders children normally", () => {
      expect(() =>
        render(
          <FocusTrap>
            <p>No buttons here</p>
          </FocusTrap>,
        ),
      ).not.toThrow();
      expect(screen.getByText("No buttons here")).toBeInTheDocument();
    });
  });
});
