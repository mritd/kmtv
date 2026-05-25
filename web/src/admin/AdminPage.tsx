/**
 * AdminPage — top-level admin dashboard that hosts the profile card, summary grid, tabs,
 * and all four admin panels (sources / subscriptions / users / settings).
 * AdminPage — 顶层管理控制台, 承载 profile card、汇总统计、标签页及四个管理面板.
 *
 * Responsibilities / 职责:
 *   - Render the admin sidebar profile card with change-password and logout actions.
 *     渲染 profile card 侧栏, 提供修改密码和退出登录操作.
 *   - Maintain the active tab selection via local state.
 *     通过本地 state 维护当前激活的标签页.
 *   - Aggregate summary stats (enabled sources, total sources, subscriptions, unhealthy).
 *     聚合汇总统计 (已启用数量、源总数、订阅数、不健康数).
 *   - Mount <AdminModal /> so all four panels share one modal root.
 *     挂载 <AdminModal />, 让四个面板共享同一弹窗根节点.
 *
 * Key exports / 主要导出:
 *   AdminPage
 *
 * Callers / 调用方:
 *   app/AppRoutes.tsx (mounted at /admin via protected route)
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useSourcesQuery, useSubscriptionsQuery } from "@/api/adminHooks";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/shared/ui/Button";
import { PageHeader } from "@/shared/ui/PageHeader";
import { adminModalStore } from "@/store/adminModalStore";

import { AdminModal } from "./AdminModal";
import { SourcesPanel } from "./SourcesPanel";
import { SubscriptionsPanel } from "./SubscriptionsPanel";
import { SystemSettingsPanel } from "./SystemSettingsPanel";
import { UsersPanel } from "./UsersPanel";

/**
 * AdminTab identifies one of the four content panels shown under the tab bar.
 * AdminTab 标识标签栏下方显示的四个内容面板之一.
 */
type AdminTab = "sources" | "subscriptions" | "users" | "settings";

// tabIds defines the fixed left-to-right rendering order for the tab bar.
// tabIds 定义标签栏从左到右的固定渲染顺序.
const tabIds: AdminTab[] = ["sources", "subscriptions", "users", "settings"];

/**
 * AdminPage is the root component for the /admin route.
 * AdminPage 是 /admin 路由的根组件.
 *
 * The summary grid is populated by the sources and subscriptions queries that are already
 * mounted here; each panel mounts its own query so they remain independently suspendable.
 * 汇总统计由已挂载的源/订阅查询填充; 每个面板独立挂载自己的查询以保持独立可暂停性.
 */
export function AdminPage() {
  const [tab, setTab] = useState<AdminTab>("sources");
  const auth = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation("admin");
  const sourcesQuery = useSourcesQuery();
  const subscriptionsQuery = useSubscriptionsQuery();

  // Derived summary counts — computed inline because they are pure and cheap.
  // 派生汇总计数 — 轻量纯计算, 直接内联无需 useMemo.
  const sources = sourcesQuery.data?.sources ?? [];
  const subscriptions = subscriptionsQuery.data?.subscriptions ?? [];
  const enabledSources = sources.filter((s) => s.enabled).length;
  const totalSources = sources.length;
  const unhealthyCount = sources.filter((s) => s.health === "unhealthy").length;
  const totalSubscriptions = subscriptions.length;

  // Avatar initial: first letter of username, uppercase; "?" when no user.
  // 头像初始字母: 用户名首字母大写; 无用户时用 "?".
  const initial = auth.user?.username.slice(0, 1).toUpperCase() ?? "?";
  const roleLabel = auth.user?.role === "admin" ? t("role.admin") : t("role.user");

  // onChangePassword opens the change-password modal for the currently signed-in user.
  // Guard prevents calling when user is null (e.g. anonymous session visiting /admin).
  // onChangePassword
  // 为当前登录用户打开修改密码弹窗.
  // 防止 user 为 null 时调用 (如匿名用户访问 /admin).
  function onChangePassword() {
    if (!auth.user) return;
    adminModalStore.getState().open({
      kind: "user.password",
      // allow_adult_content is irrelevant to the password modal and is not exposed via /me.
      // allow_adult_content 与密码弹窗无关, 且 /me 不暴露该字段.
      user: { id: auth.user.id, username: auth.user.username, role: auth.user.role, allow_adult_content: false },
    });
  }

  return (
    <main className="page admin-page">
      <div className="admin-workspace">
        <aside className="admin-profile-card">
          <div className="profile-avatar">
            {auth.user?.avatar ? <img src={auth.user.avatar} alt="" /> : initial}
          </div>
          <div className="admin-profile-meta heading-block">
            <h2>{auth.user?.username ?? t("profile.notSignedIn")}</h2>
            <p>{roleLabel}</p>
          </div>
          <div className="admin-profile-actions">
            <Button type="button" variant="secondary" onClick={() => navigate("/account")}>
              {t("profile.profileLink")}
            </Button>
            <Button type="button" variant="secondary" onClick={onChangePassword}>
              {t("profile.changePassword")}
            </Button>
            <Button type="button" variant="danger" onClick={() => void auth.logout()}>
              {t("profile.logout")}
            </Button>
          </div>
        </aside>
        <section className="admin-work-area">
          <PageHeader title={t("title")} />
          <div className="admin-tabs" role="tablist" aria-label={t("title")}>
            {tabIds.map((id) => (
              <button className={tab === id ? "active" : ""} key={id} type="button" onClick={() => setTab(id)}>
                {t(`tabs.${id}` as const)}
              </button>
            ))}
          </div>
          <div className="admin-summary-grid" aria-label={t("title")}>
            <div>
              <strong>{enabledSources}</strong>
              <span>{t("summary.enabled")}</span>
            </div>
            <div>
              <strong>{totalSources}</strong>
              <span>{t("summary.total")}</span>
            </div>
            <div>
              <strong>{totalSubscriptions}</strong>
              <span>{t("summary.subscriptions")}</span>
            </div>
            <div>
              <strong>{unhealthyCount}</strong>
              <span>{t("summary.unhealthy")}</span>
            </div>
          </div>
          {tab === "sources" ? <SourcesPanel /> : null}
          {tab === "subscriptions" ? <SubscriptionsPanel /> : null}
          {tab === "users" ? <UsersPanel /> : null}
          {tab === "settings" ? <SystemSettingsPanel /> : null}
        </section>
      </div>
      {/* AdminModal is mounted at AdminPage level so all panels share one modal root.
          AdminModal 挂载在 AdminPage 层, 让所有面板共享同一弹窗根节点. */}
      <AdminModal />
    </main>
  );
}
