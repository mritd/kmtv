/**
 * HomeHero — hero carousel displayed at the top of the home page.
 * HomeHero — 首页顶部展示的英雄轮播组件.
 *
 * Responsibilities / 职责:
 *   - Display the active hero candidate with poster, title, description, and metadata chips
 *     — 展示当前英雄候选项的海报、标题、描述及元数据徽章
 *   - Auto-advance every 5 s when focus is not inside the carousel
 *     — 当焦点不在轮播内时每 5 秒自动推进
 *   - Resume auto-advance 3 s after a manual indicator click
 *     — 手动点击指示器后 3 秒恢复自动推进
 *   - Animate slide transitions with enter/exit CSS class pairs (forward/backward direction)
 *     — 使用 enter/exit CSS 类对制作滑动过渡动画 (区分前进/后退方向)
 *   - Pauses auto-advance while any element inside the carousel holds keyboard focus
 *     — 当轮播内任意元素持有键盘焦点时暂停自动推进
 *   - Exposes `aria-live` for screen-reader announcements when paused / when cycling
 *     — 暂停/循环时通过 aria-live 向屏幕阅读器播报
 *
 * Key exports / 主要导出:
 *   HomeHero
 *
 * Callers / 调用方:
 *   viewer/home/HomePage.tsx
 *
 * Carousel timing constants (module-top, not magic numbers):
 *   heroAutoAdvanceMs  — 5000 ms normal auto-advance interval
 *   heroManualResumeMs — 3000 ms cooldown after a manual indicator click
 *   heroTransitionMs   — 980 ms CSS slide animation duration; outgoing card is cleared after this
 * 轮播时序常量 (模块顶部定义, 非魔法数字):
 *   heroAutoAdvanceMs  — 5000 ms 正常自动推进间隔
 *   heroManualResumeMs — 3000 ms 手动点击指示器后的冷却时间
 *   heroTransitionMs   — 980 ms CSS 滑动动画时长; 动画结束后清除 outgoing 卡片
 *
 * TIER 4 — behaviour-preserving only. Do not change timing constants, CSS class names,
 * or aria attributes without a coordinated design review.
 * Tier 4 — 仅允许行为保留性修改. 不得在未经设计评审的情况下更改时序常量、CSS 类名或 aria 属性.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/ui/Button";
import { PosterImage } from "@/shared/ui/PosterImage";

import type { HeroCandidate } from "./heroCandidates";
import { translateRailName } from "./railLabel";

// heroAutoAdvanceMs is the delay between automatic hero advances when the carousel is running.
// heroAutoAdvanceMs 是轮播运行时相邻英雄自动切换的间隔时间.
const heroAutoAdvanceMs = 5000;

// heroManualResumeMs is the cooldown before auto-advance resumes after a manual indicator click.
// heroManualResumeMs 是手动点击指示器后恢复自动推进的冷却时间.
const heroManualResumeMs = 3000;

// heroTransitionMs is the CSS slide animation duration; the outgoing card is cleared after this.
// heroTransitionMs 是 CSS 滑动动画时长; 超时后清除 outgoing 卡片.
const heroTransitionMs = 980;

/**
 * heroRatingValue normalises a raw Douban rating string for hero display.
 * heroRatingValue
 * 将原始豆瓣评分字符串规范化以在英雄区展示.
 *
 * Returns undefined (hides the rating chip) when rate is missing, blank, or "0".
 * 当 rate 缺失、为空或为 "0" 时返回 undefined (隐藏评分徽章).
 */
function heroRatingValue(rate?: string): string | undefined {
  const value = rate?.trim();
  return value && value !== "0" ? value : undefined;
}

/**
 * HeroSlideDirection controls which CSS enter/exit class pair is applied during a transition.
 * HeroSlideDirection
 * 控制过渡动画期间应用的 enter/exit CSS 类对.
 *
 * "forward" and "backward" are applied as CSS class suffixes (e.g. hero-motion-enter-forward).
 * CSS keyframes consume these classes to produce directional slide transitions.
 * "forward" 和 "backward" 作为 CSS 类后缀使用 (例如 hero-motion-enter-forward).
 * CSS keyframes 通过这些类实现方向性滑动过渡.
 */
type HeroSlideDirection = "forward" | "backward";

/**
 * HomeHeroProps are the props accepted by HomeHero.
 * HomeHeroProps
 * 是 HomeHero 接受的 props.
 */
interface HomeHeroProps {
  /** Eligible hero candidates from heroCandidates.selectHeroCandidates. 来自 selectHeroCandidates 的英雄候选列表. */
  candidates: HeroCandidate[];
  /** Called when the user wants to search for the active hero title. 用户希望搜索当前英雄标题时调用. */
  onSearchTitle(title: string): void;
  /** Called when no hero candidate has a title (empty hero). 英雄候选项无标题时 (空英雄) 调用. */
  onFallbackSearch(): void;
}

/**
 * HomeHero renders the hero section at the top of the home page.
 * HomeHero
 * 渲染首页顶部的英雄区域.
 *
 * When `candidates` has more than one item, the carousel is active:
 * automatic timing drives `activeIndex` forward and indicator buttons allow
 * manual jumps. The `slideDirectionTo` helper picks the shortest path around
 * the ring, producing natural forward/backward directional animations.
 * 当 candidates 超过一个时启用轮播: 自动定时器推进 activeIndex,
 * 指示器按钮允许手动跳转. slideDirectionTo 选取环形最短路径,
 * 产生自然的前进/后退方向动画.
 *
 * `isFocusPaused` tracks keyboard focus inside the carousel (but not the
 * indicators region which has its own click-to-pause semantics).
 * `isFocusPaused` 追踪轮播内部的键盘焦点 (指示器区域除外, 该区域有自己的点击暂停语义).
 *
 * `isIndicatorPaused` is set for heroManualResumeMs after every indicator click,
 * causing the auto-advance timer to use the shorter cooldown rather than the full interval.
 * 每次点击指示器后 isIndicatorPaused 保持 heroManualResumeMs 时长,
 * 使自动推进定时器使用更短的冷却时间而非完整间隔.
 */
export function HomeHero({ candidates, onSearchTitle, onFallbackSearch }: HomeHeroProps) {
  const { t } = useTranslation("viewer");
  const [activeIndex, setActiveIndex] = useState(0);
  const [isFocusPaused, setIsFocusPaused] = useState(false);
  const [isIndicatorPaused, setIsIndicatorPaused] = useState(false);
  const [outgoingCandidate, setOutgoingCandidate] = useState<HeroCandidate | undefined>();
  const [slideDirection, setSlideDirection] = useState<HeroSlideDirection>("forward");
  const activeCandidate = candidates[activeIndex] ?? candidates[0];
  const heroItem = activeCandidate?.item;
  const hasCarousel = candidates.length > 1;
  const isPaused = isFocusPaused || isIndicatorPaused;

  // Reset all transient carousel state when the candidates list identity changes (e.g. data reload).
  // 当 candidates 列表身份变化时 (例如数据重载) 重置所有瞬态轮播状态.
  useEffect(() => {
    setActiveIndex(0);
    setIsIndicatorPaused(false);
    setOutgoingCandidate(undefined);
    setSlideDirection("forward");
  }, [candidates]);

  // Clear the outgoing card after the CSS slide animation finishes.
  // The timer matches heroTransitionMs exactly so the exit element is removed
  // as soon as the animation completes, not before (which would cause a pop).
  // 在 CSS 滑动动画结束后清除 outgoing 卡片.
  // 定时器与 heroTransitionMs 精确匹配, 确保动画完成后立即移除 exit 元素而非提前 (否则会出现跳变).
  useEffect(() => {
    if (!outgoingCandidate) {
      return;
    }

    const timer = window.setTimeout(() => setOutgoingCandidate(undefined), heroTransitionMs);
    return () => window.clearTimeout(timer);
  }, [outgoingCandidate]);

  // Drive automatic hero advancement.
  // When isIndicatorPaused, use the shorter resume delay so the carousel
  // restarts promptly after the user's manual selection settles.
  // 驱动英雄自动推进.
  // 当 isIndicatorPaused 时使用更短的恢复延迟, 使用户手动选择稳定后轮播快速重启.
  useEffect(() => {
    if (!hasCarousel || isFocusPaused) {
      return;
    }

    const timer = window.setTimeout(() => {
      setIsIndicatorPaused(false);
      switchHero((activeIndex + 1) % candidates.length, "forward");
    }, isIndicatorPaused ? heroManualResumeMs : heroAutoAdvanceMs);

    return () => window.clearTimeout(timer);
  }, [activeIndex, candidates.length, hasCarousel, isFocusPaused, isIndicatorPaused]);

  /**
   * slideDirectionTo picks the shortest directional path between the current and next index.
   * slideDirectionTo
   * 在当前索引和目标索引间选取最短方向路径.
   *
   * When the forward and backward distances are equal, "forward" wins (tie-break).
   * 当前进和后退距离相等时, 取 "forward" (平局时的决胜).
   */
  function slideDirectionTo(nextIndex: number): HeroSlideDirection {
    const forwardDistance = (nextIndex - activeIndex + candidates.length) % candidates.length;
    const backwardDistance = (activeIndex - nextIndex + candidates.length) % candidates.length;
    return forwardDistance <= backwardDistance ? "forward" : "backward";
  }

  /**
   * switchHero transitions to `nextIndex` with an optional explicit direction.
   * switchHero
   * 以可选的显式方向切换到 nextIndex.
   *
   * No-ops when nextIndex equals activeIndex to avoid spurious re-renders and
   * a zero-duration outgoing transition.
   * 当 nextIndex 等于 activeIndex 时为空操作, 避免无效重渲染和零时长 outgoing 过渡.
   */
  function switchHero(nextIndex: number, direction: HeroSlideDirection = slideDirectionTo(nextIndex)) {
    if (nextIndex === activeIndex) {
      return;
    }

    setSlideDirection(direction);
    setOutgoingCandidate(activeCandidate);
    setActiveIndex(nextIndex);
  }

  /**
   * searchActiveTitle fires the appropriate search callback for the active hero.
   * searchActiveTitle
   * 为当前英雄触发合适的搜索回调.
   *
   * Falls back to onFallbackSearch when no hero item is present (empty candidates).
   * 当没有英雄条目时 (candidates 为空) 回退到 onFallbackSearch.
   */
  function searchActiveTitle() {
    if (heroItem) {
      onSearchTitle(heroItem.title);
      return;
    }

    onFallbackSearch();
  }

  /**
   * renderHeroMotion renders a single hero slide (either entering or exiting).
   * renderHeroMotion
   * 渲染单个英雄幻灯片 (进入或退出状态).
   *
   * The `key` prop combines item id/title and className to prevent React from
   * reusing the DOM node between enter and exit renders of the same candidate.
   * key prop 组合 item id/title 和 className, 防止 React 在同一候选项的
   * enter/exit 渲染间复用 DOM 节点.
   *
   * `aria-hidden="true"` on the exit slide so screen readers skip it while the
   * live region announces the newly entering candidate.
   * exit 幻灯片上设置 aria-hidden="true", 使屏幕阅读器跳过它,
   * 让 live region 只播报新进入的候选项.
   */
  function renderHeroMotion(candidate: HeroCandidate | undefined, className: string, hidden = false) {
    const item = candidate?.item;
    const ratingValue = heroRatingValue(item?.rate);
    const description = item?.desc?.trim() || t("home.heroFallbackDescription");
    const sectionLabel = candidate?.sectionName ? translateRailName(t, candidate.sectionName) : undefined;
    return (
      <div className={className} key={item?.id || item?.title || className} aria-hidden={hidden ? "true" : undefined}>
        <div className="hero-motion-copy">
          <p className="eyebrow">{sectionLabel ?? "KMTV"}</p>
          <h1>{item?.title ?? t("home.heroFallbackTitle")}</h1>
          {item ? (
            <div className="hero-meta-row" aria-label={t("home.heroMetaAria")}>
              {sectionLabel ? <span className="hero-meta-chip">{sectionLabel}</span> : null}
              {item.year ? <span className="hero-meta-chip">{item.year}</span> : null}
              {ratingValue ? <span className="hero-meta-chip">{t("home.doubanRating", { value: ratingValue })}</span> : null}
            </div>
          ) : null}
          <p className="hero-description">{description}</p>
        </div>
        <button className="hero-poster-button" type="button" onClick={searchActiveTitle} aria-label={t("home.heroPosterAria")} tabIndex={hidden ? -1 : 0}>
          <PosterImage src={item?.cover} title={item?.title ?? "KMTV"} className="hero-poster" />
        </button>
      </div>
    );
  }

  return (
    <section
      className="home-hero"
      aria-label={t("home.heroCarouselAria")}
      // aria-live is "off" while the carousel is actively cycling (updates are frequent and announced
      // via visible motion). Set to "polite" when paused so a screen reader announces the current slide.
      // 轮播主动循环时 aria-live 为 "off" (更新频繁且通过可见动画呈现).
      // 暂停时改为 "polite" 以便屏幕阅读器播报当前幻灯片.
      aria-live={hasCarousel && !isPaused ? "off" : "polite"}
      onFocus={(event) => {
        // Ignore focus events originating from the indicators row itself —
        // indicator clicks have their own pause semantics via setIsIndicatorPaused.
        // 忽略来自指示器行本身的 focus 事件 —
        // 指示器点击通过 setIsIndicatorPaused 拥有独立的暂停语义.
        if (event.target instanceof HTMLElement && event.target.closest(".hero-indicators")) {
          return;
        }
        setIsFocusPaused(true);
      }}
      onBlur={() => setIsFocusPaused(false)}
    >
      <div className="hero-stage">
        <div className={outgoingCandidate ? "hero-motion-stack hero-motion-stack-transitioning" : "hero-motion-stack"}>
          {outgoingCandidate ? renderHeroMotion(outgoingCandidate, `hero-motion hero-motion-exit hero-motion-exit-${slideDirection}`, true) : null}
          {renderHeroMotion(activeCandidate, `hero-motion hero-motion-enter hero-motion-enter-${slideDirection}`)}
        </div>
        <div className="hero-controls">
          <div className="row-actions">
            <Button type="button" variant="primary" onClick={searchActiveTitle}>
              {t("home.heroSearchAction")}
            </Button>
          </div>
          {hasCarousel ? (
            <div className="hero-indicators" aria-label={t("home.heroIndicatorsAria")}>
              {candidates.map((candidate, index) => (
                <button
                  aria-label={t("home.heroSwitchAria", { title: candidate.item.title })}
                  aria-pressed={index === activeIndex}
                  className={index === activeIndex ? "active" : ""}
                  key={`${candidate.sectionName}-${candidate.item.id || candidate.item.title}`}
                  type="button"
                  onClick={() => {
                    switchHero(index);
                    setIsIndicatorPaused(true);
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
