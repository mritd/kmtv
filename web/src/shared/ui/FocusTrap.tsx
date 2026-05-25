// FocusTrap — constrains Tab / Shift+Tab navigation to its descendants while mounted.
// FocusTrap — 在挂载期间将 Tab / Shift+Tab 导航限制在其子节点内.
//
// Exports: FocusTrap.
// Callers: Modal, ConfirmDialog — any overlay that must prevent focus from escaping to background content.
// 调用者: Modal、ConfirmDialog 等需要防止焦点逃逸到背景内容的浮层组件.
//
// Behaviour:
//   • On mount: respects React autoFocus if already active; otherwise focuses the first focusable element.
//   • While open: wraps Tab at the last element back to first, and Shift+Tab at first back to last.
//   • On unmount: restores focus to the element that was focused before the trap was mounted,
//     provided that element is not itself a descendant of the trap (guards against React autoFocus
//     running before this effect and recording a child as the "previous" owner).
// 行为:
//   • 挂载时: 如子节点已持有焦点 (React autoFocus), 则尊重; 否则聚焦首个可聚焦元素.
//   • 开启期间: Tab 在末尾循环回首个, Shift+Tab 在首个循环到末尾.
//   • 卸载时: 恢复焦点到挂载前的持有者; 若记录的元素是 trap 子节点则跳过
//     (React autoFocus 早于 effect 运行会导致子节点被记为"前一个持有者").

import { useEffect, useRef, type ReactNode } from "react";

// Selector for all elements that participate in the natural tab order.
// Excludes tabindex="-1" elements which are programmatically focusable but not in tab order.
// 匹配所有参与自然 Tab 顺序的元素, 排除 tabindex="-1" (可程序化聚焦但不在 Tab 顺序中).
const FOCUSABLE_SELECTOR =
  "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

// FocusTrap renders a wrapper div that traps Tab / Shift+Tab navigation within its children.
// On mount it focuses the first available element (unless React autoFocus already did it);
// on unmount it returns focus to the element that owned it before the trap was mounted.
// FocusTrap 渲染一个包裹 div, 将 Tab/Shift+Tab 导航限制在子节点内.
// 挂载时聚焦首个可用元素 (除非 React autoFocus 已经处理); 卸载时将焦点返还给前一个持有者.
export function FocusTrap({ children }: { children: ReactNode }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Capture the focused element synchronously during render (before React's autoFocus and before effects).
  // useRef's initial value is evaluated once, at render time, so this snapshot precedes any focus changes
  // that React's autoFocus or this effect make. This is the element we want to restore on unmount.
  // 在渲染期间同步捕获焦点元素 (早于 React 的 autoFocus 和 effect).
  // useRef 的初始值在渲染时求值一次, 因此此快照早于任何焦点变更, 是卸载时应恢复的目标.
  const restoreTargetRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // If a child already holds focus (React autoFocus fired before this effect), honour it.
    // Otherwise, move focus to the first focusable child so keyboard users can start interacting.
    // 若子节点已持有焦点 (React autoFocus 早于此 effect 触发), 尊重该状态.
    // 否则将焦点移至首个可聚焦子节点, 使键盘用户可立即交互.
    const alreadyFocusedInside = container.contains(document.activeElement) && document.activeElement !== container;
    if (!alreadyFocusedInside) {
      const initial = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      initial?.focus();
    }

    function onKey(event: KeyboardEvent) {
      if (event.key !== "Tab" || !container) return;
      const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        // Wrap Shift+Tab from first → last so focus never escapes the trap.
        // Shift+Tab 从首个元素循环到末尾, 防止焦点逃逸.
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        // Wrap Tab from last → first.
        // Tab 从末尾元素循环回首个.
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Restore focus to the pre-trap owner so the user's context is not lost after closing the overlay.
      // restoreTargetRef.current was captured at render time, before any autoFocus or effect ran.
      // Guard: only call focus() when (a) the element is still in the document (not detached by a
      // parent re-render or sibling unmount) AND (b) it is not a descendant of the trap container
      // (protects nested-trap scenarios where the restore target might be inside the trap itself).
      // 恢复焦点到 trap 前的持有者, 避免关闭浮层后用户的交互上下文丢失.
      // restoreTargetRef.current 在渲染时捕获, 早于任何 autoFocus 或 effect.
      // 保护条件: (a) 元素仍在文档中 (未被父组件或兄弟节点卸载分离), 且
      // (b) 不是 trap 容器的后代 (防止嵌套 trap 场景中恢复到 trap 内部的元素).
      const restoreTarget = restoreTargetRef.current;
      const trapContainer = containerRef.current;
      if (
        restoreTarget !== null &&
        document.contains(restoreTarget) &&
        (trapContainer === null || !trapContainer.contains(restoreTarget))
      ) {
        restoreTarget.focus();
      }
    };
  }, []);
  return <div ref={containerRef}>{children}</div>;
}
