// PosterImage — lazy-loaded poster artwork with a branded text fallback and View Transition support.
// PosterImage — 带品牌文字降级和视图过渡支持的懒加载海报图片.
//
// Exports: PosterImage.
// Callers: Home (section item cards), Search (result cards), Favorites (list rows), Detail (hero area).
// 调用者: Home (分区卡片)、Search (结果卡片)、Favorites (列表行)、Detail (主图区域).
//
// Behaviour:
//   • Renders an <img> with lazy loading when a trimmed src URL is available.
//   • Falls back to a branded "KMTV" div when src is absent or the image errors (setFailed).
//   • Applies view-transition-name via a callback ref (useViewTransitionName) so the attribute is
//     re-applied on every DOM node swap — required because React unmounts the img and mounts the
//     fallback div on error, which would otherwise lose the CSS property set by the previous node.
//   • data-view-transition-name mirrors the CSS property so tests and DevTools can inspect it without
//     reading computed styles.
//
// NOTE: Do NOT change the src value. Image URLs are proxied via the Douban CDN mirror
//   (tencent default per ADR-005 / baseline commit 666666665ad). URL transformation happens
//   at the API layer — this component receives the already-transformed URL.
// 注意: 不要修改 src 值. 图片 URL 由后端通过豆瓣 CDN 镜像代理 (Tencent 默认, 见 ADR-005).
//   URL 转换发生在 API 层, 此组件只接收已转换的 URL.

import { useCallback, useLayoutEffect, useRef, useState } from "react";

// PosterImageProps defines the public API of PosterImage.
// PosterImageProps 定义 PosterImage 的公开 API.
export interface PosterImageProps {
  // src is the fully resolved poster URL (may be absent or empty when not yet available).
  // src 是完全解析后的海报 URL; 不可用时可以缺失或为空.
  src?: string;
  // title is used as a data attribute on the <img> for external tooling; it is NOT used as alt
  // text because posters are decorative. The image always has alt="" for accessibility.
  // title 作为 data 属性附加到 <img> 供外部工具使用; 因海报为装饰性图片, 不用作 alt 文本.
  title: string;
  className?: string;
  // transitionName is the View Transition API name applied to both image and fallback node so the
  // browser can animate across route changes. Omit when no transition is needed.
  // transitionName 是视图过渡 API 的名称, 同时施加于图片和降级节点以支持路由切换动画.
  transitionName?: string;
}

// useViewTransitionName returns a stable callback ref that captures the DOM node and a layout
// effect that keeps the view-transition-name CSS property in sync with the name prop.
// useViewTransitionName 返回稳定的回调 ref 捕获 DOM 节点, 并通过 layout effect 保持 CSS 属性与 name prop 同步.
//
// Two-phase design:
//   1. Callback ref (empty deps) captures the current DOM node into posterDOMNode state. It fires on
//      every node mount/unmount (img ↔ fallback div swap on error), keeping posterDOMNode current.
//   2. useLayoutEffect keyed on [name, posterDOMNode] applies setProperty/removeProperty synchronously
//      after paint on node mount AND whenever name changes while the same node persists.
// 两阶段设计:
//   1. 回调 ref (空依赖) 将当前 DOM 节点存入 posterDOMNode 状态, 每次节点挂载/卸载时触发 (错误时 img/fallback div 切换).
//   2. useLayoutEffect 以 [name, posterDOMNode] 为依赖, 在挂载后或 name 变化时同步更新 CSS 属性.
function useViewTransitionName(name: string | undefined): (node: HTMLElement | null) => void {
  // posterDOMNode tracks the currently mounted DOM node; updated by the callback ref.
  // posterDOMNode 跟踪当前挂载的 DOM 节点, 由回调 ref 更新.
  const [posterDOMNode, setPosterDOMNode] = useState<HTMLElement | null>(null);
  const callbackRef = useCallback((node: HTMLElement | null) => {
    setPosterDOMNode(node);
  }, []);
  // Synchronously apply or remove view-transition-name whenever the name prop or the node changes.
  // 当 name prop 或节点变化时同步设置或移除 view-transition-name.
  useLayoutEffect(() => {
    if (!posterDOMNode) return;
    if (name) {
      posterDOMNode.style.setProperty("view-transition-name", name);
    } else {
      posterDOMNode.style.removeProperty("view-transition-name");
    }
  }, [name, posterDOMNode]);
  return callbackRef;
}

// PosterImage renders a lazy-loaded poster <img> when a valid src is available, or a branded
// "KMTV" fallback <div> when the src is missing or the image fails to load.
// PosterImage 在 src 有效时渲染懒加载海报 <img>, 否则渲染品牌文字降级 <div>.
export function PosterImage({ src, title, className = "", transitionName }: PosterImageProps): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  // Trim whitespace so a blank-string src is treated the same as an absent src.
  // 去除空白, 使纯空格的 src 与缺失 src 等效.
  const poster = src?.trim();
  const transitionRef = useViewTransitionName(transitionName);

  // Reset failed DURING render when poster changes (state-during-render pattern, per React docs).
  // Using useEffect would reset failed AFTER paint, causing a one-frame fallback flash when the
  // caller swaps to a new valid src after a prior error. Resetting during render means React
  // re-renders immediately with failed=false and commits only the final result — no flash.
  // 当 poster 变化时在渲染期间重置 failed (React 推荐的"渲染期间 state 更新"模式).
  // 使用 useEffect 会在绘制后重置, 导致一帧降级闪烁; 渲染期间重置使 React 立即重跑并只提交最终结果.
  const lastPosterRef = useRef<string | undefined>(undefined);
  if (poster !== lastPosterRef.current) {
    lastPosterRef.current = poster;
    if (failed) {
      // Calling setFailed during render: React will re-render immediately and NOT commit this
      // intermediate render to the DOM. The next render will have failed=false.
      // 渲染期间调用 setFailed: React 立即重渲染, 不将此中间渲染提交到 DOM.
      setFailed(false);
    }
  }

  if (!poster || failed) {
    return (
      <div
        ref={transitionRef}
        className={["poster-fallback", className].filter(Boolean).join(" ")}
        data-view-transition-name={transitionName}
      >
        <span>KMTV</span>
      </div>
    );
  }
  return (
    <img
      ref={transitionRef}
      // poster-media carries a placeholder background so a still-loading lazy poster reads as an
      // intentional fill rather than a see-through box; the opaque image paints over it once decoded.
      // poster-media 提供占位背景, 使懒加载中的海报呈现为有意的填充而非透视空框; 图片解码后会覆盖该背景.
      className={["poster-media", className].filter(Boolean).join(" ")}
      src={poster}
      // Posters are decorative artwork; an empty alt string hides them from AT's reading order.
      // 海报是装饰性图片; 空 alt 使辅助技术跳过不朗读.
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      data-title={title}
      data-view-transition-name={transitionName}
    />
  );
}
