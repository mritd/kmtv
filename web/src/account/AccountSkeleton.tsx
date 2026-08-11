/**
 * AccountSkeleton — loading placeholder for the /account route.
 *
 * AccountSkeleton — /account 路由的加载占位组件.
 *
 * Responsibilities / 职责:
 *   - Mirror the AccountPage layout (page-header + two-column .account-grid) with Skeleton blocks.
 *
 *     用 Skeleton 块镜像 AccountPage 布局 (page-header + 两列 .account-grid).
 *
 *   - Provide `role="status" aria-busy="true"` for screen-reader-friendly loading state.
 *
 *     提供 role="status" aria-busy="true" 以支持屏幕阅读器友好的加载状态.
 *
 *   - Left column mirrors the profile form skeleton (avatar + username input + actions).
 *
 *     左列镜像 profile 表单 skeleton (头像 + 用户名输入框 + 操作按钮).
 *
 *   - Right column mirrors the theme-choice grid skeleton (four swatch cards).
 *
 *     右列镜像主题选择网格 skeleton (四个色板卡片).
 *
 * Key exports / 主要导出:
 *   AccountSkeleton
 *
 * Callers / 调用方:
 *   app/AppRoutes.tsx (Suspense fallback for the lazily loaded AccountPage)
 *
 * This component has no dedicated unit test because it is static presentational JSX
 * with no conditional behavior. AppRoutes supplies it as the AccountPage Suspense fallback.
 *
 * 此组件没有专门的单元测试, 因为它是无条件分支的静态展示型 JSX.
 * AppRoutes 将它用作 AccountPage 的 Suspense fallback.
 */
import { Skeleton } from "@/shared/ui/Skeleton";

/**
 * AccountSkeleton renders a pixel-close structural placeholder for AccountPage
 * while the page's lazy-loaded code chunk is loading.
 *
 * AccountSkeleton 在 AccountPage 的延迟加载代码块载入期间渲染结构相近的占位 UI.
 *
 * It uses `aria-hidden="true"` on the inner sections so screen readers skip the
 * decorative skeletons while the outer `role="status"` wrapper announces "Loading".
 *
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
