/**
 * SubscriptionsPanel — admin panel for managing source bundle subscriptions.
 * SubscriptionsPanel — 管理源包订阅的管理面板.
 *
 * Responsibilities / 职责:
 *   - List subscriptions with their URL, sync interval, auto-update status, and last-sync date.
 *     展示订阅的 URL、同步间隔、自动更新状态和最近同步时间.
 *   - Provide per-row actions: manual sync, edit, delete.
 *     提供逐行操作: 手动同步、编辑、删除.
 *   - Provide a panel-level "new subscription" action.
 *     提供面板级 "新建订阅" 操作.
 *
 * Key exports / 主要导出:
 *   SubscriptionsPanel
 *
 * Callers / 调用方:
 *   admin/AdminPage.tsx (rendered when tab === "subscriptions")
 */
import { useTranslation } from "react-i18next";

import { useSubscriptionsQuery } from "@/api/adminHooks";
import type { Subscription } from "@/api/types";
import { Button } from "@/shared/ui/Button";
import { OptionalDate } from "@/shared/ui/OptionalDate";
import { StatusState } from "@/shared/ui/StatusState";
import { toast } from "@/shared/ui/Toast";
import { adminModalStore } from "@/store/adminModalStore";

import { useSubscriptionsMutations } from "./hooks/useSubscriptionsMutations";
import { AdminTableSkeleton } from "./skeletons/AdminTableSkeleton";

/**
 * SubscriptionsPanel renders the full subscriptions list with row actions.
 * SubscriptionsPanel 渲染完整的订阅列表及逐行操作.
 *
 * Renders a skeleton while loading, an error state on failure, and the table on success.
 * 加载中显示骨架屏, 失败时显示错误状态, 成功时显示表格.
 */
export function SubscriptionsPanel() {
  const { t } = useTranslation("admin");
  const query = useSubscriptionsQuery();
  const mutations = useSubscriptionsMutations();

  if (query.isLoading) return <AdminTableSkeleton />;
  if (query.isError) return <StatusState title={t("subscription.loadFailed")} tone="error" />;

  // handleSync triggers a manual sync for one subscription and surfaces errors via toast.
  // handleSync
  // 触发单条订阅的手动同步, 并通过 toast 展示错误.
  function handleSync(subscription: Subscription) {
    mutations.sync.mutate(subscription.id, {
      onError: (err) => {
        toast.error({
          title: t("errors.saveFailed"),
          description: err instanceof Error ? err.message : undefined,
        });
      },
    });
  }

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <h2>{t("subscription.heading")}</h2>
        <Button type="button" variant="primary" onClick={() => adminModalStore.getState().open({ kind: "subscription.new" })}>
          {t("subscription.newButton")}
        </Button>
      </div>
      <div className="admin-table">
        {(query.data?.subscriptions ?? []).map((subscription) => (
          <div className="admin-row" key={subscription.id}>
            <div className="admin-row-main">
              <strong>{subscription.url}</strong>
              <span>{subscription.interval}{t("subscription.intervalSuffix")}</span>
            </div>
            <div className="admin-row-status">
              <span className={`status-pill ${subscription.auto_update ? "status-pill-on" : "status-pill-off"}`}>
                {subscription.auto_update ? t("status.autoSync") : t("status.manual")}
              </span>
              <OptionalDate value={subscription.last_sync} className="admin-row-date" />
            </div>
            <div className="admin-row-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleSync(subscription)}
                aria-label={t("subscription.actionsAria.sync", { url: subscription.url })}
              >
                {t("subscription.syncButton")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => adminModalStore.getState().open({ kind: "subscription.edit", subscription })}
                aria-label={t("subscription.actionsAria.edit", { url: subscription.url })}
              >
                {t("subscription.editButton")}
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => adminModalStore.getState().open({ kind: "subscription.delete", subscription })}
                aria-label={t("subscription.actionsAria.delete", { url: subscription.url })}
              >
                {t("subscription.deleteButton")}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
