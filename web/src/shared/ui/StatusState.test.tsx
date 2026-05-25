// Tests for the StatusState status indicator component.
// StatusState 状态指示组件测试.
//
// Coverage targets: default tone, error tone, loading tone, description/action slots, CSS class composition.
// 覆盖目标: 默认色调、错误色调、加载色调、描述/操作插槽、CSS 类名合成.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusState } from "./StatusState";

describe("StatusState", () => {
  describe("tone variants — CSS modifier class", () => {
    it("applies 'status-state-default' when no tone is provided", () => {
      const { container } = render(<StatusState title="Info" />);
      const section = container.querySelector("section");
      expect(section).toHaveClass("status-state");
      expect(section).toHaveClass("status-state-default");
    });

    it("applies 'status-state-error' for tone='error'", () => {
      const { container } = render(<StatusState title="Error" tone="error" />);
      expect(container.querySelector("section")).toHaveClass("status-state-error");
    });

    it("applies 'status-state-loading' for tone='loading'", () => {
      const { container } = render(<StatusState title="Loading…" tone="loading" />);
      expect(container.querySelector("section")).toHaveClass("status-state-loading");
    });
  });

  describe("title rendering", () => {
    it("renders the title as an h2", () => {
      render(<StatusState title="Something went wrong" />);
      expect(screen.getByRole("heading", { level: 2, name: "Something went wrong" })).toBeInTheDocument();
    });
  });

  describe("optional description", () => {
    it("renders a paragraph when description is provided", () => {
      render(<StatusState title="Error" description="Please try again later." />);
      expect(screen.getByText("Please try again later.")).toBeInTheDocument();
    });

    it("does not render a paragraph when description is omitted", () => {
      const { container } = render(<StatusState title="Error" />);
      expect(container.querySelector("p")).toBeNull();
    });
  });

  describe("optional action slot", () => {
    it("renders the action element when provided", () => {
      render(
        <StatusState
          title="Error"
          action={<button type="button">Retry</button>}
        />,
      );
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });

    it("does not render the action wrapper when action is omitted", () => {
      // The action div is only rendered when action is truthy; omitting it keeps the DOM clean.
      // 仅当 action 为真值时才渲染 action div, 省略时保持 DOM 简洁.
      const { container } = render(<StatusState title="Error" />);
      // There should be no div descendants (only the section and h2 exist).
      // 应无 div 子节点 (只有 section 和 h2).
      expect(container.querySelectorAll("div")).toHaveLength(0);
    });
  });
});
