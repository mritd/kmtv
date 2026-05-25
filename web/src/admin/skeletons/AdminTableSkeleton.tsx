/**
 * AdminTableSkeleton / SettingsListSkeleton — loading placeholder skeletons for admin panel tables.
 * AdminTableSkeleton / SettingsListSkeleton — 管理面板表格的加载占位骨架屏.
 *
 * Responsibilities / 职责:
 *   - Mirror live .admin-table row layout so rows hydrate in-place without layout shift
 *     镜像真实 .admin-table 行结构, 使真实数据到达时行就地填充, 没有抖动
 *   - Mirror .settings-list two-column row used by SystemSettingsPanel
 *     镜像 SystemSettingsPanel 的 .settings-list 两列结构
 *
 * Key exports / 主要导出:
 *   AdminTableSkeleton, SettingsListSkeleton
 *
 * Callers / 调用方:
 *   admin/SourcesPanel.tsx (AdminTableSkeleton)
 *   admin/SubscriptionsPanel.tsx (AdminTableSkeleton)
 *   admin/UsersPanel.tsx (AdminTableSkeleton)
 *   admin/SystemSettingsPanel.tsx (SettingsListSkeleton)
 *
 * NOTE: This file is in the vitest skeleton exclude list because it has no branching logic —
 * only static Skeleton composition. Excluded tests: see vitest.config.ts.
 * 注意: 此文件在 vitest 骨架屏排除列表中, 因为它只有静态 Skeleton 组合, 无分支逻辑.
 */

import { Skeleton } from "@/shared/ui/Skeleton";

/**
 * AdminTableSkeleton renders N placeholder rows matching the live admin-table row structure.
 * AdminTableSkeleton 渲染 N 个与真实 admin-table 行结构一致的占位行.
 *
 * Each row mirrors: name/url stack in .admin-row-main, status pill in .admin-row-status,
 * and 3-4 action chips in .admin-row-actions. Real classNames are reused so rows
 * hydrate in place once data lands.
 * 每行镜像: .admin-row-main 内 name/url 双行, .admin-row-status 状态 pill,
 * .admin-row-actions 操作按钮. 复用真实 className, 数据到达时就地填充.
 *
 * @param rows - number of placeholder rows to render (default: 6) / 渲染的占位行数 (默认: 6)
 */
export function AdminTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="admin-table admin-table-skeleton" role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, idx) => (
        <div className="admin-row" key={idx} aria-hidden="true">
          <div className="admin-row-main">
            <strong>
              <Skeleton width="38%" height="1rem" />
            </strong>
            <span>
              <Skeleton width="58%" height="0.85rem" />
            </span>
          </div>
          <div className="admin-row-status">
            <Skeleton className="admin-skeleton-pill" width="76px" height="22px" />
            <Skeleton width="120px" height="0.85rem" />
          </div>
          <div className="admin-row-actions">
            <Skeleton width="68px" height="32px" />
            <Skeleton width="68px" height="32px" />
            <Skeleton width="76px" height="32px" />
            <Skeleton width="68px" height="32px" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * SettingsListSkeleton renders N placeholder rows matching the .settings-list two-column layout.
 * SettingsListSkeleton 渲染 N 个与 .settings-list 两列结构一致的占位行.
 *
 * Live styles lock the value column to a fixed height; only row count matters here.
 * 真实样式已锁 value 列高度, 这里只需保证行数一致, 不产生抖动.
 *
 * @param rows - number of placeholder rows to render (default: 10) / 渲染的占位行数 (默认: 10)
 */
export function SettingsListSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="settings-list admin-table-skeleton" role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, idx) => (
        <div className="settings-list-row" key={idx} aria-hidden="true">
          <div className="settings-list-label">
            <Skeleton width="58%" height="0.95rem" />
          </div>
          <div className="settings-list-value">
            <Skeleton width="100%" height="32px" />
          </div>
        </div>
      ))}
    </div>
  );
}
