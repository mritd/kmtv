// IncognitoAvatar component tests.
// IncognitoAvatar 组件测试.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IncognitoAvatar } from "./IncognitoAvatar";

describe("IncognitoAvatar", () => {
  it("renders an SVG with role=img", () => {
    render(<IncognitoAvatar />);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("uses 'Anonymous' as the default accessible label", () => {
    render(<IncognitoAvatar />);
    expect(screen.getByRole("img", { name: "Anonymous" })).toBeInTheDocument();
  });

  it("uses a custom label when provided", () => {
    render(<IncognitoAvatar label="匿名用户" />);
    expect(screen.getByRole("img", { name: "匿名用户" })).toBeInTheDocument();
  });

  it("applies className to the SVG element", () => {
    const { container } = render(<IncognitoAvatar className="avatar-lg" />);
    const svg = container.querySelector("svg");
    expect(svg?.classList.contains("avatar-lg")).toBe(true);
  });

  it("renders without a className when none is provided", () => {
    const { container } = render(<IncognitoAvatar />);
    const svg = container.querySelector("svg");
    // class attribute should be absent or empty when no className is passed.
    // 未传 className 时 class 属性应缺失或为空.
    expect(svg?.getAttribute("class") ?? "").toBe("");
  });

  it("has a 24x24 viewBox for consistent sizing", () => {
    const { container } = render(<IncognitoAvatar />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg?.getAttribute("width")).toBe("24");
    expect(svg?.getAttribute("height")).toBe("24");
  });
});
