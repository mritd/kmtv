// Tests for the PageHeader page-level header component.
// PageHeader 页面级标题组件测试.
//
// Coverage targets: title-only, eyebrow, description, action slot, all props combined.
// 覆盖目标: 仅标题、眉题、描述、操作插槽、所有属性组合.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  describe("title only (required)", () => {
    it("renders the title as an h1", () => {
      render(<PageHeader title="Settings" />);
      expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    });

    it("does not render the eyebrow element when omitted", () => {
      const { container } = render(<PageHeader title="Settings" />);
      // No .eyebrow node should be in the DOM — absence of the class confirms no wrapper was rendered.
      // 无 .eyebrow 节点意味着包裹元素未被渲染, 比文字内容断言更可靠.
      expect(container.querySelector(".eyebrow")).toBeNull();
    });

    it("does not render the action slot when omitted", () => {
      const { container } = render(<PageHeader title="Settings" />);
      expect(container.querySelector(".page-header-action")).toBeNull();
    });
  });

  describe("with eyebrow", () => {
    it("renders the eyebrow text above the title", () => {
      render(<PageHeader eyebrow="Admin" title="Sources" />);
      // Eyebrow renders as a <p class="eyebrow"> element.
      // 眉题渲染为 <p class="eyebrow"> 元素.
      const eyebrow = screen.getByText("Admin");
      expect(eyebrow.tagName).toBe("P");
      expect(eyebrow).toHaveClass("eyebrow");
    });
  });

  describe("with description", () => {
    it("renders the description as a paragraph inside the heading block", () => {
      render(<PageHeader title="Users" description="Manage team members and roles." />);
      expect(screen.getByText("Manage team members and roles.")).toBeInTheDocument();
    });

    it("does not render a description paragraph when omitted", () => {
      const { container } = render(<PageHeader title="Users" />);
      // Only one p element (no description) — when both eyebrow and description are absent, no <p>.
      // 无描述时只有 h1, 无 <p> 元素.
      expect(container.querySelectorAll("p")).toHaveLength(0);
    });
  });

  describe("with action", () => {
    it("renders the action inside the page-header-action wrapper", () => {
      render(
        <PageHeader
          title="Sources"
          action={<button type="button">Add source</button>}
        />,
      );
      expect(screen.getByRole("button", { name: "Add source" })).toBeInTheDocument();
      // Confirm the action is wrapped correctly for layout alignment.
      // 确认操作元素被正确包裹以对齐布局.
      const wrapper = document.querySelector(".page-header-action");
      expect(wrapper).toBeInTheDocument();
      expect(wrapper?.querySelector("button")).toBeInTheDocument();
    });
  });

  describe("all props combined", () => {
    it("renders eyebrow, h1 title, description, and action together", () => {
      render(
        <PageHeader
          eyebrow="Admin"
          title="Sources"
          description="Configure video sources."
          action={<button type="button">Add</button>}
        />,
      );
      expect(screen.getByText("Admin")).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 1, name: "Sources" })).toBeInTheDocument();
      expect(screen.getByText("Configure video sources.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    });
  });
});
