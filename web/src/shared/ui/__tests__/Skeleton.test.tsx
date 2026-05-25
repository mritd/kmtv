import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Skeleton, SkeletonGroup } from "../Skeleton";

describe("Skeleton", () => {
  it("standalone renders a status element with aria-busy", () => {
    render(<Skeleton ariaLabel="Loading poster" standalone />);
    const node = screen.getByRole("status");
    expect(node).toHaveAttribute("aria-busy", "true");
    expect(node).toHaveAttribute("aria-label", "Loading poster");
  });

  it("default mode is aria-hidden (decorative) to avoid nested live regions", () => {
    const { container } = render(<Skeleton />);
    const node = container.querySelector(".skeleton");
    expect(node).toHaveAttribute("aria-hidden", "true");
    expect(node).not.toHaveAttribute("role");
  });

  it("applies inline width and height as style attributes", () => {
    render(<Skeleton width={200} height="3rem" standalone />);
    const node = screen.getByRole("status");
    // Inline style attribute keeps the literal values (happy-dom normalizes 3rem in computed style).
    // 行内 style 保留原值, happy-dom 在计算样式时会归一化.
    expect(node.getAttribute("style")).toContain("width: 200px");
    expect(node.getAttribute("style")).toContain("height: 3rem");
  });
});

describe("SkeletonGroup", () => {
  it("exposes exactly one status region with decorative children", () => {
    render(
      <SkeletonGroup>
        <Skeleton />
        <Skeleton />
      </SkeletonGroup>,
    );
    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(1);
  });
});
