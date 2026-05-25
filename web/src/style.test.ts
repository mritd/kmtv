// @ts-expect-error Vitest runs this file in Node, while the app tsconfig stays browser-only.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function heroMotionAnimationDurationMs(css: string) {
  const match = css.match(/\.hero-motion-enter\s*\{[\s\S]*?animation-duration:\s*(\d+)ms/);
  return match ? Number(match[1]) : 0;
}

function heroIndicatorPadding(css: string) {
  const block = css.match(/\.hero-indicators\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const match = block.match(/padding:\s*(\d+)px\s+(\d+)px/);
  return match ? { block: Number(match[1]), inline: Number(match[2]) } : { block: 0, inline: 0 };
}

function cssBlock(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
}

describe("global styles", () => {
  it("keeps the hero carousel transition cinematic rather than abrupt", () => {
    const css = readFileSync("src/style.css", "utf8");

    expect(heroMotionAnimationDurationMs(css)).toBeGreaterThanOrEqual(900);
  });

  it("keeps hero carousel transitions sharp without blur", () => {
    const css = readFileSync("src/style.css", "utf8");
    const heroTransitionCss = css.match(/@keyframes hero-motion-enter-forward[\s\S]*?@keyframes hero-motion-exit-backward[\s\S]*?\n\}/)?.[0] ?? "";

    expect(heroTransitionCss).not.toContain("blur(");
  });

  it("keeps hero carousel transitions inside the hero stack", () => {
    const css = readFileSync("src/style.css", "utf8");
    const heroTransitionCss = css.match(/@keyframes hero-motion-enter-forward[\s\S]*?@keyframes hero-motion-exit-backward[\s\S]*?\n\}/)?.[0] ?? "";

    expect(heroTransitionCss).not.toContain("scale(");
    expect(heroTransitionCss).not.toContain("translate3d(100%");
    expect(heroTransitionCss).not.toContain("translate3d(-100%");
    expect(heroTransitionCss).toContain("translate3d(0, 0, 0)");
  });

  it("keeps the hero background on theme colors instead of hard-coded black", () => {
    const css = readFileSync("src/style.css", "utf8");
    const heroCss = css.match(/\.home-hero\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(heroCss).not.toContain("rgba(3, 4, 5");
    expect(heroCss).toContain("var(--bg)");
  });

  it("keeps hero poster glow unclipped during carousel transitions", () => {
    const css = readFileSync("src/style.css", "utf8");
    const stackCss = css.match(/\.hero-motion-stack\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    const transitionCss = css.match(/\.hero-motion-stack-transitioning\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(stackCss).toContain("overflow: visible");
    expect(stackCss).not.toContain("mask-image");
    expect(transitionCss).not.toContain("mask-image");
    expect(transitionCss).not.toContain("-webkit-mask-image");
    expect(css).not.toContain("hero-edge-mask-fade");
  });

  it("keeps hero carousel indicator side padding roomy", () => {
    const css = readFileSync("src/style.css", "utf8");
    const padding = heroIndicatorPadding(css);

    expect(padding.block).toBe(8);
    expect(padding.inline).toBeGreaterThanOrEqual(18);
  });

  it("keeps the search form grouped and the submit button stable", () => {
    const css = readFileSync("src/style.css", "utf8");
    const searchBarCss = css.match(/\.search-bar\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(searchBarCss).toContain("grid-template-columns: minmax(0, 1fr) 128px");
    expect(searchBarCss).toContain("align-items: stretch");
  });

  it("keeps search result actions equal width", () => {
    const css = readFileSync("src/style.css", "utf8");
    const actionsCss = css.match(/\.video-result-actions\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(actionsCss).toContain("grid-template-columns: 1fr");
    expect(actionsCss).toContain("width: var(--result-action-width)");
  });

  it("keeps search result posters at a unified card size", () => {
    const css = readFileSync("src/style.css", "utf8");
    const cardCss = css.match(/\.video-result-card\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    const posterActionCss = css.match(/\.video-result-card \.poster-action\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    const posterMediaCss = css.match(/\.video-result-card \.poster-fallback,\n\.video-result-card img\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(cardCss).toContain("grid-template-columns: var(--result-poster-width) minmax(0, 1fr) var(--result-action-width)");
    expect(posterActionCss).toContain("width: var(--result-poster-width)");
    expect(posterMediaCss).toContain("width: var(--result-poster-width)");
    expect(posterMediaCss).toContain("aspect-ratio: 2 / 3");
    expect(posterMediaCss).toContain("object-fit: cover");
  });

  it("keeps search result poster hover motion available for real and fallback posters", () => {
    const css = readFileSync("src/style.css", "utf8");
    const hoverCss = cssBlock(css, ".video-result-card .poster-action:hover:not(:disabled) .poster-frame");

    expect(hoverCss).toContain("scale(1.025)");
    expect(hoverCss).toContain("brightness(1.08)");
  });

  it("keeps rating badges as yellow flush tabs bound to poster hover motion", () => {
    const css = readFileSync("src/style.css", "utf8");
    const badgeCss = cssBlock(css, ".poster-rating-badge");
    const badgeLabelCss = cssBlock(css, ".poster-rating-badge::after");
    const frameCss = cssBlock(css, ".poster-frame");
    const homeHoverCss = cssBlock(css, ".poster-tile:hover:not(:disabled) .poster-frame");
    const resultHoverCss = cssBlock(css, ".video-result-card .poster-action:hover:not(:disabled) .poster-frame");

    expect(badgeCss).toContain("#f6c453");
    expect(badgeCss).toContain("min-width: 58px");
    expect(badgeCss).toContain("height: 27px");
    expect(badgeCss).toContain("padding: 0 10px");
    expect(badgeLabelCss).not.toContain('content: "豆瓣"');
    expect(frameCss).toContain("overflow: hidden");
    expect(homeHoverCss).toContain("scale(1.025)");
    expect(resultHoverCss).toContain("scale(1.025)");
  });

  it("aligns home hero copy and rails while pulling the poster inward", () => {
    const css = readFileSync("src/style.css", "utf8");
    const heroCss = cssBlock(css, ".home-hero");
    const stageCss = cssBlock(css, ".hero-stage");
    const stackCss = cssBlock(css, ".hero-motion-stack");
    const motionCss = cssBlock(css, ".hero-motion");
    const copyCss = cssBlock(css, ".hero-motion-copy");
    const descriptionCss = cssBlock(css, ".hero-description");
    const controlsCss = cssBlock(css, ".hero-controls");
    const eyebrowCss = cssBlock(css, ".eyebrow");
    const pageHeaderEyebrowCss = cssBlock(css, ".page-header .eyebrow");
    const metadataCss = cssBlock(css, ".hero-meta-row");
    const posterButtonCss = cssBlock(css, ".hero-poster-button");
    const homeContentCss = cssBlock(css, ".home-content");

    expect(heroCss).toContain("--home-content-max: 1880px");
    expect(heroCss).toContain("--home-content-pad: clamp(18px, 4vw, 54px)");
    expect(heroCss).toContain("padding-inline: max(var(--home-content-pad), calc((100vw - var(--home-content-max)) / 2 + var(--home-content-pad)))");
    expect(stageCss).toContain("grid-template-columns: minmax(0, 1fr) minmax(360px, 0.42fr)");
    expect(stackCss).toContain("overflow: visible");
    expect(motionCss).toContain("grid-template-columns: minmax(0, 1fr) minmax(360px, 0.42fr)");
    expect(motionCss).toContain("align-items: center");
    expect(copyCss).not.toContain("min-height: clamp(230px, 22vw, 320px)");
    expect(descriptionCss).toContain("-webkit-line-clamp: 3");
    expect(descriptionCss).toContain("overflow: hidden");
    expect(controlsCss).toContain("grid-row: 2");
    expect(posterButtonCss).toContain("align-self: center");
    expect(posterButtonCss).toContain("justify-self: start");
    expect(posterButtonCss).toContain("margin-left: clamp(12px, 2vw, 28px)");
    expect(eyebrowCss).toContain("margin: 0 0 clamp(18px, 2vw, 28px)");
    expect(pageHeaderEyebrowCss).toContain("margin-bottom: clamp(18px, 2vw, 28px)");
    expect(metadataCss).toContain("margin-top: clamp(10px, 1.4vw, 18px)");
    expect(metadataCss).not.toContain("margin-top: -4px");
    expect(posterButtonCss).toContain("width: min(340px, 23vw)");
    expect(posterButtonCss).toContain("min-height: 320px");
    expect(posterButtonCss).toContain("translateY(clamp(30px, 4vw, 60px))");
    expect(posterButtonCss).toContain("min-width: 240px");
    expect(descriptionCss).toContain("height: calc(1.7em * 3)");
    expect(homeContentCss).toContain("width: min(100%, 1880px)");
    expect(homeContentCss).not.toContain("var(--home-content-max)");
  });

  it("keeps page summaries separated from large headings", () => {
    const css = readFileSync("src/style.css", "utf8");
    const summaryCss = cssBlock(css, ".page-header .page-header-summary");

    expect(summaryCss).toContain("margin-top: clamp(12px, 1.4vw, 18px)");
  });

  it("keeps result action buttons at a compact shared width", () => {
    const css = readFileSync("src/style.css", "utf8");
    const cardCss = cssBlock(css, ".video-result-card");
    const actionsCss = cssBlock(css, ".video-result-actions");

    expect(cardCss).toContain("--result-action-width: 148px");
    expect(actionsCss).toContain("width: var(--result-action-width)");
    expect(actionsCss).toContain("justify-self: end");
    expect(actionsCss).toContain("margin-right: clamp(12px, 2vw, 28px)");
    expect(actionsCss).not.toContain("min-width: 180px");
  });

  it("keeps result descriptions away from the action column", () => {
    const css = readFileSync("src/style.css", "utf8");
    const copyCss = cssBlock(css, ".video-result-copy");
    const clampCss = cssBlock(css, ".clamp");
    const favoriteClampCss = cssBlock(css, ".favorites-page .clamp");
    const tabletCss = css.match(/@media \(max-width: 920px\) \{[\s\S]*?@media \(max-width: 560px\)/)?.[0] ?? "";

    expect(copyCss).toContain("width: 80%");
    expect(copyCss).toContain("justify-self: start");
    expect(clampCss).toContain("-webkit-line-clamp: 3");
    expect(favoriteClampCss).not.toContain("-webkit-line-clamp: 1");
    expect(tabletCss).toContain(".video-result-copy {\n    width: 100%;\n  }");
  });

  it("keeps player status pills out of native video controls", () => {
    const css = readFileSync("src/style.css", "utf8");
    const pillsCss = cssBlock(css, ".player-state-pills");

    expect(pillsCss).toContain("position: static");
    expect(pillsCss).not.toContain("bottom:");
  });

  it("keeps source buttons in an adaptive wrapping grid", () => {
    const css = readFileSync("src/style.css", "utf8");
    const sourcePickerCss = cssBlock(css, ".source-picker");
    const sourceButtonCss = cssBlock(css, ".source-button");
    const sourceToggleCss = cssBlock(css, ".source-picker-toggle");
    const latencyGoodCss = cssBlock(css, ".source-latency-good");
    const latencyWarnCss = cssBlock(css, ".source-latency-warn");
    const latencyBadCss = cssBlock(css, ".source-latency-bad");

    expect(sourcePickerCss).toContain("grid-template-columns: repeat(auto-fit, minmax(min(100%, 148px), 1fr))");
    expect(sourcePickerCss).not.toContain("grid-template-columns: 1fr");
    expect(sourceButtonCss).toContain("display: grid");
    expect(sourceButtonCss).toContain("border-radius: 10px");
    expect(sourceButtonCss).toContain("background: var(--surface-strong)");
    expect(sourceToggleCss).toContain("grid-column: 1 / -1");
    expect(latencyGoodCss).toContain("#54d86a");
    expect(latencyWarnCss).toContain("#f6c453");
    expect(latencyBadCss).toContain("#fb4667");
  });

  it("keeps the hero title wide enough without an oversized desktop cap", () => {
    const css = readFileSync("src/style.css", "utf8");
    const copyCss = cssBlock(css, ".hero-motion-copy");
    const titleCss = cssBlock(css, ".hero-motion-copy h1");

    expect(copyCss).toContain("max-width: 800px");
    expect(titleCss).toContain("font-size: clamp(3.8rem, 7vw, 6.4rem)");
    expect(titleCss).toContain("text-wrap: balance");
  });

  it("makes the poster tile fill its cell so unloaded posters do not grow from small", () => {
    const css = readFileSync("src/style.css", "utf8");
    // Regression guard: .poster-tile is a <button> that shrink-to-fits; without width:100% an
    // unloaded poster collapses to a fraction of the cell and snaps to full size once the image
    // loads. Verified via headless layout measurement (loaded vs pending tile width).
    // 回归防护: .poster-tile 是会收缩到内容的 <button>; 缺少 width:100% 时未加载海报会塌缩到单元格的
    // 一小部分, 待图片加载后突然撑满. 已通过无头布局测量验证 (loaded 与 pending tile 宽度).
    const tileCss = cssBlock(css, ".poster-tile");

    expect(tileCss).toContain("width: 100%");
  });

  it("gives poster images a placeholder background so loading posters are not see-through boxes", () => {
    const css = readFileSync("src/style.css", "utf8");
    // Regression guard: a still-loading lazy poster <img> must paint a placeholder fill behind it,
    // otherwise the transparent <img> reveals the .poster-frame shadow as a bare dark box.
    // 回归防护: 懒加载中的海报 <img> 背后必须有占位填充, 否则透明的 <img> 会露出 .poster-frame 阴影成为空框.
    const posterMediaCss = cssBlock(css, ".poster-media");

    expect(posterMediaCss).toContain("background:");
    expect(posterMediaCss).toContain("var(--surface)");
  });

  it("styles region filter chips as a distinct outline variant via the row container", () => {
    const css = readFileSync("src/style.css", "utf8");
    // The variant must hang off the row container (.category-chip-row-region .category-chip),
    // not a chip-level descendant selector that could never match a chip of itself.
    // 该变体必须挂在行容器上 (.category-chip-row-region .category-chip),
    // 而非永远无法匹配自身的 chip 级后代选择器.
    const regionChipCss = cssBlock(css, ".category-chip-row-region .category-chip");
    const regionChipActiveCss = cssBlock(css, ".category-chip-row-region .category-chip.is-active");

    expect(regionChipCss).toContain("border-color: var(--border)");
    expect(regionChipCss).toContain("background: transparent");
    expect(regionChipActiveCss).toContain("var(--accent)");
  });

  it("renders search progress with a dedicated thin bar plus shimmer", () => {
    const css = readFileSync("src/style.css", "utf8");
    const progressCardCss = css.match(/\.search-progress-card\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    const phaseBarCss = css.match(/\.search-phase-bar\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    const phaseFillCss = css.match(/\.search-phase-bar-fill\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    const activeShimmerCss =
      css.match(/\.search-phase-card-active \.search-phase-bar-fill::after\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    const doneFillCss = css.match(/\.search-phase-card-done \.search-phase-bar-fill\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

    // The outer progress card stays frameless;
    // visual weight lives in the phase cards.
    // 外层进度卡保持无外框, 视觉重量交给阶段卡.
    expect(progressCardCss).not.toContain("border:");
    expect(progressCardCss).not.toContain("background:");
    // The track clips the fill;
    // the fill uses --search-phase-progress with a width transition.
    // 轨道裁剪填充, 填充用 --search-phase-progress 配合 width 过渡.
    expect(phaseBarCss).toContain("overflow: hidden");
    expect(phaseFillCss).toContain("width: var(--search-phase-progress");
    expect(phaseFillCss).toContain("var(--accent)");
    expect(phaseFillCss).toContain("transition: width");
    // Active state runs a single GPU-friendly translateX shimmer.
    // 活跃态用单一 transform translateX 的 shimmer 动画.
    expect(activeShimmerCss).toContain("animation: search-phase-shimmer");
    expect(activeShimmerCss).toContain("translateX");
    // Done state has no animation, just a settled fill color.
    // 完成态无动画, 仅保留稳定填充颜色.
    expect(doneFillCss).not.toContain("animation:");
  });
});
