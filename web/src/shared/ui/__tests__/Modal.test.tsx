import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Modal } from "../Modal";

describe("Modal", () => {
  it("renders nothing when isOpen is false", () => {
    render(
      <Modal isOpen={false} onClose={() => undefined} labelledBy="title">
        <h2 id="title">Hidden</h2>
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders dialog with aria-labelledby when open", () => {
    render(
      <Modal isOpen onClose={() => undefined} labelledBy="title">
        <h2 id="title">Visible</h2>
        <button type="button">First</button>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-labelledby", "title");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: "Visible" })).toBeInTheDocument();
  });

  it("calls onClose when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose} labelledBy="t">
        <h2 id="t">Title</h2>
        <button type="button">Action</button>
      </Modal>,
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop is clicked, not when the content is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose} labelledBy="t">
        <h2 id="t">Title</h2>
        <button type="button">Inside</button>
      </Modal>,
    );
    // Clicking content does NOT close.
    // 点击内容不关闭.
    await user.click(screen.getByRole("button", { name: "Inside" }));
    expect(onClose).not.toHaveBeenCalled();

    // Clicking the backdrop closes (mousedown + mouseup on backdrop itself).
    // 点击遮罩关闭.
    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop");
    expect(backdrop).not.toBeNull();
    if (backdrop) {
      fireEvent.mouseDown(backdrop);
      fireEvent.mouseUp(backdrop);
      expect(onClose).toHaveBeenCalledTimes(1);
    }
  });

  it("does not close when press starts inside dialog and releases on backdrop", () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose} labelledBy="t">
        <h2 id="t">Title</h2>
        <input aria-label="field" />
      </Modal>,
    );
    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const input = screen.getByLabelText("field");

    // Simulate selecting text in the input and releasing outside the dialog:
    // mousedown on input -> mouseup on backdrop -> synthetic click on backdrop (LCA).
    fireEvent.mouseDown(input);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close when press starts on backdrop and releases inside dialog", () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose} labelledBy="t">
        <h2 id="t">Title</h2>
        <input aria-label="field" />
      </Modal>,
    );
    const backdrop = document.querySelector<HTMLElement>(".modal-backdrop")!;
    const input = screen.getByLabelText("field");

    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(input);
    fireEvent.click(backdrop);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("traps Tab focus inside the dialog", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Outside</button>
        <Modal isOpen onClose={() => undefined} labelledBy="t">
          <h2 id="t">Title</h2>
          <button type="button">First</button>
          <button type="button">Second</button>
        </Modal>
      </>,
    );

    // FocusTrap moves focus to the first focusable inside the dialog on mount.
    // FocusTrap
    // 挂载时把焦点移入对话框内第一个可聚焦元素.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Second" }));

    // Tab from the last item wraps to the first inside the trap.
    // 从最后一个 Tab 时循环到首个.
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
  });
});
