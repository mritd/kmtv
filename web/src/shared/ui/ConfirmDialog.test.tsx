// ConfirmDialog tests — cover action dispatch and optional pending-state disabling.
//
// ConfirmDialog 测试 — 覆盖动作触发和可选 pending 状态禁用.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("calls confirm and cancel handlers from the dialog actions", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        title="Clear watch history"
        description="This removes all progress entries."
        confirmLabel="Clear"
        cancelLabel="Cancel"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Clear watch history" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("can disable both actions while the caller is pending", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        title="Clear watch history"
        confirmLabel="Clearing"
        cancelLabel="Cancel"
        confirmDisabled
        cancelDisabled
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const confirm = screen.getByRole("button", { name: "Clearing" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(confirm).toBeDisabled();
    expect(cancel).toBeDisabled();

    await user.click(confirm);
    await user.click(cancel);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("keeps keyboard focus inside the modal dialog", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        title="Clear watch history"
        confirmLabel="Clear"
        cancelLabel="Cancel"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const confirm = screen.getByRole("button", { name: "Clear" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(confirm).toHaveFocus();
    await user.tab({ shift: true });
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(confirm).toHaveFocus();
  });
});
