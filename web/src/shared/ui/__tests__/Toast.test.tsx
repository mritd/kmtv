import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastContainer, toast, useToastStore, useSessionExpiredToast } from "../Toast";

describe("Toast", () => {
  beforeEach(() => {
    useToastStore.setState({ items: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders pushed items and dismisses on close button click", async () => {
    const user = userEvent.setup();
    render(<ToastContainer />);

    act(() => {
      toast.warning({ title: "Session expired" });
    });

    expect(screen.getByText("Session expired")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss notification" }));
    await waitFor(() => {
      expect(screen.queryByText("Session expired")).toBeNull();
    });
  });

  it("renders description and uses role=alert for errors", () => {
    render(<ToastContainer />);
    act(() => {
      toast.error({ title: "Save failed", description: "public_base_url: invalid" });
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Save failed");
    expect(screen.getByText("public_base_url: invalid")).toBeInTheDocument();
  });

  it("auto-dismisses after default duration", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ToastContainer />);
    act(() => {
      toast.info({ title: "Auto bye" });
    });
    expect(screen.getByText("Auto bye")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    // Run real timers so the AnimatePresence exit completes.
    // 切回真实计时器让退出动画跑完.
    vi.useRealTimers();
    await waitFor(() => {
      expect(screen.queryByText("Auto bye")).toBeNull();
    });
  });

  it("respects duration: 0 (no auto-dismiss)", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ToastContainer />);
    act(() => {
      toast.info({ title: "Sticky", duration: 0 });
    });
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(screen.getByText("Sticky")).toBeInTheDocument();
  });

  it("supports legacy message-based push for back-compat", () => {
    render(<ToastContainer />);
    act(() => {
      useToastStore.getState().push({ message: "Legacy", tone: "info" });
    });
    expect(screen.getByText("Legacy")).toBeInTheDocument();
  });
});

describe("useSessionExpiredToast — duplicate-on-remount guard (F4)", () => {
  // Each test fully resets the store (items + sessionToastFiredKey) so tests are independent.
  // 每个测试完整重置 store (items + sessionToastFiredKey) 以保证测试间独立.
  beforeEach(() => {
    useToastStore.setState({ items: [], sessionToastFiredKey: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function SessionHost({ reason }: { reason: string | null }) {
    useSessionExpiredToast(reason, "Session expired");
    return null;
  }

  it("fires the session-expired toast exactly once on initial mount", () => {
    render(<ToastContainer />);
    act(() => {
      render(<SessionHost reason="unauthorized" />);
    });
    expect(useToastStore.getState().items).toHaveLength(1);
  });

  it("does not fire a duplicate toast when the host unmounts and remounts with the same reason", () => {
    // Bug: lastFired is a per-instance useRef. When the host remounts, the new instance's
    // lastFired.current is null, so the effect fires the toast again.
    // Fix: module-level dedup key so the guard survives host unmount/remount.
    // 缺陷: lastFired 是实例级 useRef; 宿主重挂载时新实例的 lastFired.current 为 null,
    // effect 再次触发 toast.
    // 修复: 模块级去重 key, 跨宿主挂载/卸载持久.
    render(<ToastContainer />);
    const { unmount } = render(<SessionHost reason="unauthorized" />);
    expect(useToastStore.getState().items).toHaveLength(1);

    // Unmount then remount with the SAME reason — must NOT fire again.
    // 卸载后用相同 reason 重挂载 — 不应再次触发.
    unmount();
    render(<SessionHost reason="unauthorized" />);
    expect(useToastStore.getState().items).toHaveLength(1);
  });

  it("fires a new toast when the reason changes after remount", () => {
    // After the fix, a genuinely different reason key should still trigger a fresh toast.
    // 修复后, 真正不同的 reason key 仍应触发新的 toast.
    render(<ToastContainer />);
    const { unmount } = render(<SessionHost reason="unauthorized" />);
    expect(useToastStore.getState().items).toHaveLength(1);
    unmount();
    // Clear items to make counting easier.
    // 清除条目以便计数.
    useToastStore.setState({ items: [] });
    render(<SessionHost reason="expired" />);
    expect(useToastStore.getState().items).toHaveLength(1);
  });

  it("fires again after a new auth cycle (reason: unauthorized → null → unauthorized)", () => {
    // High finding from Codex: the dedup key must be cleared when reason becomes non-toastable
    // (null / successful login), so a subsequent independent expiry can fire a fresh toast.
    // Codex High: 当 reason 变为不可弹 toast 的值时必须清除去重 key,
    // 以便后续独立的认证过期能触发新的 toast.
    render(<ToastContainer />);
    const { rerender } = render(<SessionHost reason="unauthorized" />);
    expect(useToastStore.getState().items).toHaveLength(1);

    // Simulate login: reason goes to null (auth cycle resets).
    // 模拟登录: reason 变为 null (认证周期重置).
    rerender(<SessionHost reason={null} />);
    // Clear items to simulate a fresh session.
    // 清除条目模拟新会话.
    useToastStore.setState({ items: [] });

    // New expiry with the same reason — must fire again.
    // 相同 reason 的新过期 — 必须再次触发 toast.
    rerender(<SessionHost reason="unauthorized" />);
    expect(useToastStore.getState().items).toHaveLength(1);
  });
});
