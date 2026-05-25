/**
 * AccountSkeleton — loading placeholder for the /account route.
 * AccountSkeleton — /account 路由的加载占位组件.
 *
 * Responsibilities / 职责:
 *   - Mirror the AccountPage layout (page-header + two-column .account-grid) with Skeleton blocks.
 *     用 Skeleton 块镜像 AccountPage 布局 (page-header + 两列 .account-grid).
 *   - Provide `role="status" aria-busy="true"` for screen-reader-friendly loading state.
 *     提供 role="status" aria-busy="true" 以支持屏幕阅读器友好的加载状态.
 *   - Left column mirrors the profile form skeleton (avatar + username input + actions).
 *     左列镜像 profile 表单 skeleton (头像 + 用户名输入框 + 操作按钮).
 *   - Right column mirrors the theme-choice grid skeleton (four swatch cards).
 *     右列镜像主题选择网格 skeleton (四个色板卡片).
 *
 * Key exports / 主要导出:
 *   AccountSkeleton
 *
 * Callers / 调用方:
 *   app/AppRoutes.tsx (Suspense fallback for the lazily loaded AccountPage)
 *
 * NOTE: This file is intentionally comment-only (no tests).
 * The component is pure presentational JSX with no branching logic — every Skeleton
 * renders unconditionally, so there is nothing to assert beyond visual structure.
 * Although the vitest coverage exclude pattern "src/**\/skeletons\/**" does not
 * technically match this path (the file is directly in src/account/, not in a
 * "skeletons" subdirectory), no tests are added here because the component has
 * zero conditional branches and is exercised by AccountPage Suspense fallback E2E flows.
 * 注意: 此文件仅添加注释, 无需测试.
 * 该组件是纯展示型 JSX, 无分支逻辑 — 每个 Skeleton 均无条件渲染, 无可断言的分支.
 * vitest 覆盖率 exclude 模式 "src/**\/skeletons\/**" 技术上不匹配此路径
 * (文件在 src/account/ 下, 而非 "skeletons" 子目录), 但因组件无条件件分支,
 * 仅由 AccountPage Suspense fallback 端到端流程覆盖, 故不添加测试.
 */
import { Skeleton } from "@/shared/ui/Skeleton";

/**
 * AccountSkeleton renders a pixel-close structural placeholder for AccountPage
 * while the page's data and code chunks are still loading.
 * AccountSkeleton 在 AccountPage 数据与代码块加载期间渲染结构相近的占位 UI.
 *
 * It uses `aria-hidden="true"` on the inner sections so screen readers skip the
 * decorative skeletons while the outer `role="status"` wrapper announces "Loading".
 * 内部 section 使用 aria-hidden="true" 让屏幕阅读器跳过装饰性 skeleton,
 * 外层 role="status" wrapper 宣告 "Loading".
 */
export function AccountSkeleton() {
  return (
    <div className="account-skeleton" role="status" aria-busy="true" aria-label="Loading">
      <section className="page-header" aria-hidden="true">
        <div>
          <p className="eyebrow">
            <Skeleton width="120px" height="0.9rem" />
          </p>
          <h1>
            <Skeleton width="280px" height="2.6rem" />
          </h1>
          <p className="page-header-summary">
            <Skeleton width="320px" height="1rem" />
          </p>
        </div>
      </section>
      <section className="account-grid" aria-hidden="true">
        <div className="settings-panel">
          <div className="heading-block">
            <h2>
              <Skeleton width="60%" height="1.4rem" />
            </h2>
            <p className="muted">
              <Skeleton width="40%" height="0.9rem" />
            </p>
          </div>
          <Skeleton width="120px" height="120px" />
          <Skeleton width="100%" height="44px" />
          <div className="row-actions">
            <Skeleton width="120px" height="42px" />
            <Skeleton width="100px" height="42px" />
          </div>
        </div>
        <div className="settings-panel">
          <div className="heading-block">
            <h2>
              <Skeleton width="50%" height="1.4rem" />
            </h2>
            <p className="muted">
              <Skeleton width="70%" height="0.9rem" />
            </p>
          </div>
          <div className="theme-choice-grid">
            {Array.from({ length: 4 }).map((_, idx) => (
              <Skeleton key={idx} height="92px" />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
