// Tests for the Skeleton and SkeletonGroup loading placeholder components.
// Skeleton 和 SkeletonGroup 加载占位组件测试.
//
// Coverage targets: render + ARIA roles (standalone vs. group) + style props + class composition.
// 覆盖目标: 渲染 + ARIA 角色 (standalone vs. group) + 样式属性 + 类名合成.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Skeleton, SkeletonGroup } from "./Skeleton";

describe("Skeleton", () => {
  describe("when not standalone (default)", () => {
    it("renders a decorative span hidden from screen readers", () => {
      const { container } = render(<Skeleton />);
      const span = container.querySelector("span");
      expect(span).toBeInTheDocument();
      // Non-standalone skeletons are aria-hidden so SkeletonGroup is the single live region.
      // 非 standalone skeleton 设置 aria-hidden, 让 SkeletonGroup 成为唯一实时区域.
      expect(span).toHaveAttribute("aria-hidden", "true");
      expect(span).not.toHaveAttribute("role");
    });

    it("includes the 'skeleton' base class", () => {
      const { container } = render(<Skeleton />);
      expect(container.querySelector("span")).toHaveClass("skeleton");
    });

    it("appends a custom className to the base class", () => {
      const { container } = render(<Skeleton className="my-custom" />);
      const span = container.querySelector("span");
      expect(span).toHaveClass("skeleton");
      expect(span).toHaveClass("my-custom");
    });
  });

  describe("when standalone=true", () => {
    it("renders a status region with aria-busy", () => {
      render(<Skeleton standalone ariaLabel="Loading content" />);
      const region = screen.getByRole("status");
      expect(region).toBeInTheDocument();
      expect(region).toHaveAttribute("aria-busy", "true");
    });

    it("uses the provided ariaLabel on the status region", () => {
      render(<Skeleton standalone ariaLabel="Loading poster" />);
      expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading poster");
    });

    it("falls back to 'Loading' when no ariaLabel is given", () => {
      render(<Skeleton standalone />);
      expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading");
    });
  });

  describe("width and height style props", () => {
    it("sets pixel width and height from number values", () => {
      const { container } = render(<Skeleton width={120} height={80} />);
      const span = container.querySelector("span");
      expect(span).toHaveStyle({ width: "120px", height: "80px" });
    });

    it("sets width from a percentage string and height from a pixel string", () => {
      // Use px for height because happy-dom converts rem to px (16px base) during style resolution,
      // which makes rem-value assertions unreliable in unit tests.
      // 高度使用 px, 因为 happy-dom 会将 rem 转换为 px (16px 基准), rem 断言在单元测试中不可靠.
      const { container } = render(<Skeleton width="100%" height="48px" />);
      const span = container.querySelector("span");
      expect(span).toHaveStyle({ width: "100%", height: "48px" });
    });

    it("does not set inline width/height when props are omitted", () => {
      const { container } = render(<Skeleton />);
      const span = container.querySelector("span");
      // No inline width/height → browser uses CSS class rules.
      // 无内联宽高 → 浏览器使用 CSS 类规则.
      expect(span?.style.width).toBe("");
      expect(span?.style.height).toBe("");
    });
  });
});

describe("SkeletonGroup", () => {
  it("renders a single status live region with aria-busy", () => {
    render(
      <SkeletonGroup>
        <Skeleton />
        <Skeleton />
      </SkeletonGroup>,
    );
    const region = screen.getByRole("status");
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region).toHaveAttribute("aria-label", "Loading");
  });

  it("includes the 'skeleton-group' base class", () => {
    const { container } = render(<SkeletonGroup><Skeleton /></SkeletonGroup>);
    expect(container.firstChild).toHaveClass("skeleton-group");
  });

  it("appends a custom className to the base class", () => {
    const { container } = render(<SkeletonGroup className="my-group"><Skeleton /></SkeletonGroup>);
    const div = container.firstChild as HTMLElement;
    expect(div).toHaveClass("skeleton-group");
    expect(div).toHaveClass("my-group");
  });

  it("renders its children inside the group", () => {
    render(
      <SkeletonGroup>
        <Skeleton className="child-a" />
        <Skeleton className="child-b" />
      </SkeletonGroup>,
    );
    // Children are rendered inside the single status region — no double announcements.
    // 子节点在唯一 status 区域内渲染, 不产生重复播报.
    expect(document.querySelectorAll(".skeleton")).toHaveLength(2);
  });
});
