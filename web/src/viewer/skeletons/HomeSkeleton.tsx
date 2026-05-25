/**
 * HomeSkeleton — Suspense fallback mirroring the HomePage full structure.
 * HomeSkeleton — 镜像 HomePage 完整结构的 Suspense 回退组件.
 *
 * Responsibilities / 职责:
 *   - Provide a layout-accurate placeholder while HomePage's lazy chunk loads — 在 HomePage 懒加载块期间提供布局精确的占位符
 *   - Prevent cumulative layout shift by reusing the real CSS class graph — 通过复用真实 CSS 类图防止累积布局偏移
 *   - Signal screen readers that content is loading via role="status" + aria-busy — 通过 role="status" + aria-busy 向屏幕阅读器告知内容正在加载
 *
 * Layout shadow / 布局镜像:
 *   Mirrors HomePage:
 *     .home-skeleton
 *       .home-hero — hero stage with eyebrow + h1 + meta row + description + poster
 *         .hero-controls — action button + dot indicators
 *       .home-content — 2 × .rail-section with section-heading + .poster-rail (8 tiles each)
 *   Reuses live classNames (.home-hero, .hero-stage, .rail-section, .poster-rail, etc.)
 *   so the page-level CSS handles all layout; zero drift risk between skeleton and real page.
 *   镜像 HomePage:
 *     .home-skeleton
 *       .home-hero — hero 区含 eyebrow + h1 + meta 行 + 描述 + 海报
 *         .hero-controls — 操作按钮 + 点状指示器
 *       .home-content — 2 × .rail-section 含 section-heading + .poster-rail (每个 8 格)
 *   复用实时 className (.home-hero / .hero-stage / .rail-section / .poster-rail 等),
 *   让页面级 CSS 处理所有布局; 骨架与真实页面之间零漂移风险.
 *
 * Callers / 调用方:
 *   app/AppRoutes.tsx (Suspense fallback for the / home lazy route)
 *
 * Test exclusion / 测试排除:
 *   This file matches the vitest.config.ts coverage exclude pattern for skeletons directories.
 *   No tests are needed: this component has no conditional branches, no state, and no callbacks.
 *   Array.from() calls are static; there is no branching logic anywhere in this file.
 *   Visual correctness is validated by E2E Suspense observation.
 *   此文件匹配 vitest.config.ts 的 skeletons 目录覆盖率排除模式.
 *   无需测试: 该组件无条件分支、无状态、无回调.
 *   Array.from() 调用为静态; 文件中无任何分支逻辑.
 *   视觉正确性由 E2E Suspense 观察验证.
 */

import { Skeleton } from "@/shared/ui/Skeleton";

/**
 * HomeSkeleton — pure presentational Suspense fallback for HomePage.
 * HomeSkeleton — HomePage 的纯展示型 Suspense 回退.
 *
 * Renders the hero section and two rail sections with Skeleton placeholders.
 * The same-column rhythm keeps the page from jumping when the real content arrives.
 * 渲染 hero 区和两个 rail 区的骨架占位符.
 * 相同的列节奏防止真实内容出现时页面跳动.
 */
export function HomeSkeleton() {
  return (
    <div className="home-skeleton" role="status" aria-busy="true" aria-label="Loading">
      <section className="home-hero" aria-hidden="true">
        <div className="hero-stage">
          <div className="hero-motion-stack">
            <div className="hero-motion">
              <div className="hero-motion-copy">
                <p className="eyebrow">
                  <Skeleton width="120px" height="0.9rem" />
                </p>
                <h1>
                  <Skeleton width="60%" height="3.4rem" />
                </h1>
                <div className="hero-meta-row">
                  <Skeleton width="92px" height="26px" />
                  <Skeleton width="78px" height="26px" />
                  <Skeleton width="110px" height="26px" />
                </div>
                <p className="hero-description">
                  <Skeleton width="100%" height="1.05rem" />
                  <Skeleton width="92%" height="1.05rem" />
                  <Skeleton width="78%" height="1.05rem" />
                </p>
              </div>
              <span className="hero-poster-button" aria-hidden="true">
                <Skeleton className="hero-poster" />
              </span>
            </div>
          </div>
          <div className="hero-controls">
            <div className="row-actions">
              <Skeleton width="148px" height="44px" />
            </div>
            <div className="hero-indicators" aria-hidden="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className="hero-indicator-placeholder" />
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="home-content">
        {Array.from({ length: 2 }).map((_, sectionIdx) => (
          <section className="rail-section" key={sectionIdx}>
            <div className="section-heading">
              <h2>
                <Skeleton width="160px" height="1.4rem" />
              </h2>
              <span>
                <Skeleton width="56px" height="0.9rem" />
              </span>
            </div>
            <div className="poster-rail" aria-hidden="true">
              {Array.from({ length: 8 }).map((_, idx) => (
                <div className="poster-rail-item" key={idx}>
                  <span className="poster-tile">
                    <span className="poster-frame">
                      <Skeleton className="poster-skeleton-frame" />
                    </span>
                    <span className="poster-title">
                      <Skeleton width="88%" height="0.9rem" />
                    </span>
                    <span className="poster-meta">
                      <Skeleton width="40%" height="0.8rem" />
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
