/**
 * UsersPanel — admin panel for managing registered user accounts.
 * UsersPanel — 管理注册用户账户的管理面板.
 *
 * Responsibilities / 职责:
 *   - List all users with their username and role badge.
 *     展示所有用户的用户名和角色徽章.
 *   - Provide per-row actions: edit, change password, delete.
 *     提供逐行操作: 编辑、修改密码、删除.
 *   - Provide a panel-level "new user" action.
 *     提供面板级 "新建用户" 操作.
 *
 * Key exports / 主要导出:
 *   UsersPanel
 *
 * Callers / 调用方:
 *   admin/AdminPage.tsx (rendered when tab === "users")
 *
 * Note: the Users tab is visible to all admins but the API itself enforces admin-only access.
 * 注意: 用户标签页对所有管理员可见, 但 API 本身强制执行仅管理员访问.
 */
import { useTranslation } from "react-i18next";

import { useUsersQuery } from "@/api/adminHooks";
import { Button } from "@/shared/ui/Button";
import { StatusState } from "@/shared/ui/StatusState";
import { adminModalStore } from "@/store/adminModalStore";

import { AdminTableSkeleton } from "./skeletons/AdminTableSkeleton";

/**
 * UsersPanel renders the full user list with row actions.
 * UsersPanel 渲染完整的用户列表及逐行操作.
 *
 * Renders a skeleton while loading, an error state on failure, and the table on success.
 * 加载中显示骨架屏, 失败时显示错误状态, 成功时显示表格.
 */
export function UsersPanel() {
  const { t } = useTranslation("admin");
  const query = useUsersQuery();

  if (query.isLoading) return <AdminTableSkeleton />;
  if (query.isError) return <StatusState title={t("user.loadFailed")} tone="error" />;

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <h2>{t("user.heading")}</h2>
        <Button type="button" variant="primary" onClick={() => adminModalStore.getState().open({ kind: "user.new" })}>
          {t("user.newButton")}
        </Button>
      </div>
      <div className="admin-table">
        {(query.data?.users ?? []).map((user) => (
          <div className="admin-row" key={user.id}>
            <div className="admin-row-main">
              <strong>{user.username}</strong>
              <span>{user.role === "admin" ? t("role.admin") : t("role.user")}</span>
            </div>
            <div className="admin-row-status">
              <span className={`status-pill ${user.role === "admin" ? "status-pill-on" : "status-pill-off"}`}>
                {user.role === "admin" ? t("role.admin") : t("role.user")}
              </span>
            </div>
            <div className="admin-row-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => adminModalStore.getState().open({ kind: "user.edit", user })}
                aria-label={t("user.actionsAria.edit", { username: user.username })}
              >
                {t("user.editButton")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => adminModalStore.getState().open({ kind: "user.password", user })}
                aria-label={t("user.actionsAria.password", { username: user.username })}
              >
                {t("user.passwordButton")}
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => adminModalStore.getState().open({ kind: "user.delete", user })}
                aria-label={t("user.actionsAria.delete", { username: user.username })}
              >
                {t("user.deleteButton")}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
