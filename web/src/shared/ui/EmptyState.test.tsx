// Tests for the EmptyState placeholder component.
// EmptyState 空状态占位组件测试.
//
// Coverage targets: title-only, with description, with action, with both.
// 覆盖目标: 仅标题、带描述、带操作、描述和操作均有.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  describe("title only", () => {
    it("renders the title as an h2", () => {
      render(<EmptyState title="No results" />);
      expect(screen.getByRole("heading", { level: 2, name: "No results" })).toBeInTheDocument();
    });

    it("does not render a description paragraph when omitted", () => {
      const { container } = render(<EmptyState title="No results" />);
      expect(container.querySelector("p")).toBeNull();
    });

    it("does not render the action slot when omitted", () => {
      const { container } = render(<EmptyState title="No results" />);
      expect(container.querySelector(".empty-state-action")).toBeNull();
    });
  });

  describe("with description", () => {
    it("renders the description text in a paragraph", () => {
      render(<EmptyState title="No favorites" description="Add some items to see them here." />);
      expect(screen.getByText("Add some items to see them here.")).toBeInTheDocument();
    });
  });

  describe("with action", () => {
    it("renders the action slot inside the action wrapper div", () => {
      render(
        <EmptyState
          title="Nothing here"
          action={<button type="button">Add item</button>}
        />,
      );
      // The action element must be present and accessible.
      // 操作元素必须存在且可访问.
      expect(screen.getByRole("button", { name: "Add item" })).toBeInTheDocument();
    });

    it("wraps the action in the empty-state-action div", () => {
      const { container } = render(
        <EmptyState title="Nothing here" action={<button type="button">Go</button>} />,
      );
      const wrapper = container.querySelector(".empty-state-action");
      expect(wrapper).toBeInTheDocument();
      expect(wrapper?.querySelector("button")).toBeInTheDocument();
    });
  });

  describe("with description and action", () => {
    it("renders heading, description, and action together", () => {
      render(
        <EmptyState
          title="No sources"
          description="Connect a source to start watching."
          action={<button type="button">Add source</button>}
        />,
      );
      expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
      expect(screen.getByText("Connect a source to start watching.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add source" })).toBeInTheDocument();
    });
  });
});
