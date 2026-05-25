import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PosterImage } from "../PosterImage";

describe("PosterImage transitionName", () => {
  it("forwards transitionName via data attribute on the image", () => {
    const { container } = render(<PosterImage src="https://example.com/p.jpg" title="t" transitionName="poster-abc" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("data-view-transition-name")).toBe("poster-abc");
  });

  it("forwards transitionName via data attribute on the fallback span", () => {
    const { container } = render(<PosterImage title="t" transitionName="poster-xyz" />);
    const fallback = container.querySelector(".poster-fallback");
    expect(fallback).not.toBeNull();
    expect(fallback?.getAttribute("data-view-transition-name")).toBe("poster-xyz");
  });

  it("omits the data attribute when no transitionName is provided", () => {
    const { container } = render(<PosterImage src="https://example.com/p.jpg" title="t" />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("data-view-transition-name")).toBeNull();
  });

  it("applies view-transition-name via CSS setProperty on mount", () => {
    const { container } = render(<PosterImage src="https://example.com/p.jpg" title="t" transitionName="poster-css" />);
    const img = container.querySelector("img");
    // The setProperty callback ref runs on attach; verify the resulting style declaration exposes the property.
    // setProperty
    // 回调 ref 在节点挂载时执行, 校验 style 中存在该属性.
    expect(img?.style.getPropertyValue("view-transition-name")).toBe("poster-css");
  });

  it("re-applies view-transition-name to the fallback node when the image errors", () => {
    const { container } = render(<PosterImage src="https://example.com/missing.jpg" title="t" transitionName="poster-keep" />);
    const img = container.querySelector("img") as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.style.getPropertyValue("view-transition-name")).toBe("poster-keep");
    // fireEvent dispatches a synthetic event the React handler is bound to.
    // fireEvent
    // 触发 React 监听的合成事件.
    if (img) fireEvent.error(img);
    const fallback = container.querySelector(".poster-fallback") as HTMLElement | null;
    expect(fallback).not.toBeNull();
    expect(fallback?.style.getPropertyValue("view-transition-name")).toBe("poster-keep");
  });
});
