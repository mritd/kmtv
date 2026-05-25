// PosterImage component tests — branching logic (src present/absent, error state, className, props).
// PosterImage 组件测试 — 分支逻辑 (src 存在/缺失、错误状态、className、属性).

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { act } from "@testing-library/react";

import { PosterImage } from "./PosterImage";

describe("PosterImage", () => {
  describe("when src is provided and does not error", () => {
    it("renders an <img> with the given src", () => {
      const { container } = render(<PosterImage src="https://example.com/cover.jpg" title="My Movie" />);
      const img = container.querySelector("img");
      expect(img).not.toBeNull();
      expect(img?.getAttribute("src")).toBe("https://example.com/cover.jpg");
    });

    it("uses empty alt so the poster is treated as decorative", () => {
      const { container } = render(<PosterImage src="https://example.com/cover.jpg" title="My Movie" />);
      expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
    });

    it("sets lazy loading on the <img>", () => {
      const { container } = render(<PosterImage src="https://example.com/cover.jpg" title="My Movie" />);
      expect(container.querySelector("img")?.getAttribute("loading")).toBe("lazy");
    });

    it("forwards title via data-title attribute, not alt", () => {
      const { container } = render(<PosterImage src="https://example.com/cover.jpg" title="My Movie" />);
      expect(container.querySelector("img")?.getAttribute("data-title")).toBe("My Movie");
    });

    it("applies className to the <img>", () => {
      const { container } = render(
        <PosterImage src="https://example.com/cover.jpg" title="t" className="poster-sm" />,
      );
      expect(container.querySelector("img")?.classList.contains("poster-sm")).toBe(true);
    });

    it("does not render the fallback div", () => {
      const { container } = render(<PosterImage src="https://example.com/cover.jpg" title="t" />);
      expect(container.querySelector(".poster-fallback")).toBeNull();
    });
  });

  describe("when src is absent or blank", () => {
    it("renders the fallback div when src is undefined", () => {
      const { container } = render(<PosterImage title="No Cover" />);
      expect(container.querySelector(".poster-fallback")).not.toBeNull();
      expect(container.querySelector("img")).toBeNull();
    });

    it("renders the fallback div when src is empty string", () => {
      const { container } = render(<PosterImage src="" title="No Cover" />);
      expect(container.querySelector(".poster-fallback")).not.toBeNull();
    });

    it("renders the fallback div when src is whitespace only (trim guard)", () => {
      // A src of only whitespace should be treated as absent after trimming.
      // 纯空白 src 去除空格后视为缺失.
      const { container } = render(<PosterImage src="   " title="No Cover" />);
      expect(container.querySelector(".poster-fallback")).not.toBeNull();
    });

    it("renders 'KMTV' brand text inside the fallback", () => {
      render(<PosterImage title="No Cover" />);
      expect(screen.getByText("KMTV")).toBeInTheDocument();
    });

    it("applies className to the fallback div", () => {
      const { container } = render(<PosterImage title="t" className="poster-lg" />);
      const fallback = container.querySelector(".poster-fallback");
      expect(fallback?.classList.contains("poster-lg")).toBe(true);
    });
  });

  describe("when src is provided but the image errors", () => {
    it("switches to the fallback div after an onError event", () => {
      const { container } = render(<PosterImage src="https://example.com/broken.jpg" title="t" />);
      const img = container.querySelector("img") as HTMLImageElement;
      expect(img).not.toBeNull();
      fireEvent.error(img);
      expect(container.querySelector(".poster-fallback")).not.toBeNull();
      expect(container.querySelector("img")).toBeNull();
    });

    it("shows 'KMTV' brand text in the fallback after error", () => {
      const { container } = render(<PosterImage src="https://example.com/broken.jpg" title="t" />);
      fireEvent.error(container.querySelector("img") as HTMLImageElement);
      expect(screen.getByText("KMTV")).toBeInTheDocument();
    });

    it("recovers and shows <img> when src changes to a new URL after a prior error", () => {
      // This guards the useEffect reset: without it, `failed` stays true even after src changes.
      // 验证 useEffect 重置: 若缺少该重置, src 变更后 `failed` 仍为 true, 导致降级 div 持续显示.
      const { container, rerender } = render(
        <PosterImage src="https://example.com/broken.jpg" title="t" />,
      );
      fireEvent.error(container.querySelector("img") as HTMLImageElement);
      expect(container.querySelector(".poster-fallback")).not.toBeNull();

      // Re-render with a new valid src — failed should reset to false and img should appear.
      // 换入新的有效 src 重渲染 — failed 应重置为 false, <img> 应重新出现.
      act(() => {
        rerender(<PosterImage src="https://example.com/new-cover.jpg" title="t" />);
      });
      expect(container.querySelector("img")).not.toBeNull();
      expect(container.querySelector(".poster-fallback")).toBeNull();
    });
  });

  describe("no one-frame fallback flash on src change after error (F8)", () => {
    it("resets failed state during render so the new src renders img without an intermediate fallback commit", () => {
      // Bug: useEffect resetting failed fires AFTER paint. When src changes after a prior error,
      // the first render with the new src value has failed=true (stale), causing an intermediate
      // commit where the fallback div is in the DOM. Only the second render (after the effect)
      // shows the img. This is a one-frame flash in browser rendering.
      // Fix: use the "state during render" pattern — track lastPoster ref and call setFailed(false)
      // during the render body when poster changes. React detects the state update, bails on the
      // current render, re-renders immediately, and commits only the final (failed=false) result.
      // 缺陷: useEffect 重置 failed 在绘制后触发; src 变更后首次渲染 failed=true, 有中间提交显示降级 div.
      // 修复: 使用"渲染期间 state 更新"模式, 跟踪 lastPoster ref; poster 变化时在渲染体内调用
      // setFailed(false), React 立即重跑渲染, 只提交最终 (failed=false) 结果.
      //
      // To expose the intermediate commit in test: track every render output in a log array.
      // With the bug: log will contain "fallback" then "img" after the src-change rerender.
      // With the fix: log will contain only "img" after the src-change rerender.
      // 通过日志数组记录每次渲染输出来暴露中间提交:
      // 有缺陷: src 变更重渲染后日志包含 "fallback" 再 "img".
      // 修复后: 日志只包含 "img".
      const commitLog: string[] = [];
      const commitLogRef = { current: commitLog };

      // CommitLogger wraps PosterImage and records the committed DOM state after each render.
      // CommitLogger 包裹 PosterImage, 在每次渲染提交后记录 DOM 状态.
      function CommitLogger({ src }: { src?: string }) {
        const containerRef = React.useRef<HTMLDivElement>(null);
        React.useLayoutEffect(() => {
          const container = containerRef.current;
          if (!container) return;
          const hasImg = container.querySelector("img") !== null;
          const hasFallback = container.querySelector(".poster-fallback") !== null;
          commitLogRef.current.push(hasImg ? "img" : hasFallback ? "fallback" : "neither");
        });
        return (
          <div ref={containerRef}>
            <PosterImage src={src} title="t" />
          </div>
        );
      }

      const { container, rerender } = render(<CommitLogger src="https://example.com/broken.jpg" />);
      // Trigger error on the img so failed=true.
      // 触发错误使 failed=true.
      fireEvent.error(container.querySelector("img") as HTMLImageElement);
      // Clear log of initial renders; we only care about what happens on src change.
      // 清除初始渲染日志, 只关注 src 变更时的行为.
      commitLog.length = 0;

      // Re-render with a new src. With the fix, the log must NOT contain an intermediate "fallback".
      // 换入新 src 重渲染. 修复后日志不得包含中间 "fallback".
      rerender(<CommitLogger src="https://example.com/new-cover.jpg" />);
      expect(commitLog).not.toContain("fallback");
      expect(commitLog).toContain("img");
    });
  });

  describe("stale transitionName regression (F1)", () => {
    it("updates view-transition-name CSS property when transitionName prop changes on the same instance", () => {
      // Bug: the callback ref has empty deps, so it only fires on node mount, not on prop change.
      // When the same DOM node persists across re-renders, the CSS property stays stale.
      // 缺陷: 回调 ref 依赖为空, 仅在节点挂载时执行, prop 变化时不更新.
      // 同一节点跨渲染持续存在时, CSS 属性保持旧值.
      const { container, rerender } = render(
        <PosterImage src="https://example.com/cover.jpg" title="t" transitionName="a" />,
      );
      const img = container.querySelector("img") as HTMLImageElement;
      expect(img.style.getPropertyValue("view-transition-name")).toBe("a");
      // Re-render with a different transitionName on the same component instance.
      // 在同一组件实例上用不同 transitionName 重渲染.
      rerender(<PosterImage src="https://example.com/cover.jpg" title="t" transitionName="b" />);
      expect(img.style.getPropertyValue("view-transition-name")).toBe("b");
    });

    it("removes view-transition-name CSS property when transitionName prop is removed", () => {
      // When transitionName goes from a value to undefined, removeProperty must be called.
      // transitionName 从有值变为 undefined 时必须调用 removeProperty.
      const { container, rerender } = render(
        <PosterImage src="https://example.com/cover.jpg" title="t" transitionName="a" />,
      );
      const img = container.querySelector("img") as HTMLImageElement;
      expect(img.style.getPropertyValue("view-transition-name")).toBe("a");
      rerender(<PosterImage src="https://example.com/cover.jpg" title="t" />);
      expect(img.style.getPropertyValue("view-transition-name")).toBe("");
    });
  });

  describe("view transition name", () => {
    it("omits data-view-transition-name when transitionName is not provided", () => {
      const { container } = render(<PosterImage src="https://example.com/cover.jpg" title="t" />);
      // The attribute must be absent (not empty string) when no transitionName is given.
      // transitionName 未提供时属性必须完全缺失.
      expect(container.querySelector("img")?.hasAttribute("data-view-transition-name")).toBe(false);
    });

    it("sets data-view-transition-name on <img> when transitionName is provided", () => {
      const { container } = render(
        <PosterImage src="https://example.com/cover.jpg" title="t" transitionName="poster-42" />,
      );
      expect(container.querySelector("img")?.getAttribute("data-view-transition-name")).toBe("poster-42");
    });

    it("sets data-view-transition-name on fallback div when transitionName is provided", () => {
      const { container } = render(<PosterImage title="t" transitionName="poster-42" />);
      expect(container.querySelector(".poster-fallback")?.getAttribute("data-view-transition-name")).toBe("poster-42");
    });

    it("sets view-transition-name CSS property via callback ref on the img element", () => {
      const { container } = render(
        <PosterImage src="https://example.com/cover.jpg" title="t" transitionName="poster-css" />,
      );
      const img = container.querySelector("img") as HTMLImageElement;
      expect(img.style.getPropertyValue("view-transition-name")).toBe("poster-css");
    });

    it("re-applies view-transition-name to fallback node after image error", () => {
      // When the img errors and React replaces it with the fallback div, the callback ref must
      // fire again on the new node. This validates the callback-ref strategy.
      // img 出错后 React 替换为降级 div; 回调 ref 必须在新节点上重新执行.
      const { container } = render(
        <PosterImage src="https://example.com/broken.jpg" title="t" transitionName="poster-persist" />,
      );
      fireEvent.error(container.querySelector("img") as HTMLImageElement);
      const fallback = container.querySelector(".poster-fallback") as HTMLElement;
      expect(fallback.style.getPropertyValue("view-transition-name")).toBe("poster-persist");
    });
  });
});
