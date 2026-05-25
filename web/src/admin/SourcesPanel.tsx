/**
 * SourcesPanel — admin panel for managing all configured video sources.
 * SourcesPanel — 管理所有已配置视频源的管理面板.
 *
 * Responsibilities / 职责:
 *   - List sources sorted: non-adult first, then adult (by source.is_adult), preserving server order.
 *     按顺序展示源: 非成人源在前, 成人源 (按 source.is_adult) 在后, 组内保持服务器顺序.
 *   - Provide per-row actions: check health, edit, enable/disable, delete.
 *     提供逐行操作: 探测健康、编辑、启用/禁用、删除.
 *   - Provide bulk actions: check-all, enable-all, import, new.
 *     提供批量操作: 全量探测、启用全部、导入、新建.
 *   - Poll automatically while any source is mid-probe (driven by useSourcesQuery).
 *     任一源处于探测中时自动轮询 (由 useSourcesQuery 驱动).
 *
 * Key exports / 主要导出:
 *   SourcesPanel
 *
 * Callers / 调用方:
 *   admin/AdminPage.tsx (rendered when tab === "sources")
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useCheckSourceMutation, useSourcesQuery } from "@/api/adminHooks";
import type { Source } from "@/api/types";
import { formatSourceHealth } from "@/shared/format";
import { Button } from "@/shared/ui/Button";
import { OptionalDate } from "@/shared/ui/OptionalDate";
import { StatusState } from "@/shared/ui/StatusState";
import { toast } from "@/shared/ui/Toast";
import { adminModalStore } from "@/store/adminModalStore";

import { useSourcesMutations } from "./hooks/useSourcesMutations";
import { AdminTableSkeleton } from "./skeletons/AdminTableSkeleton";

// isNsfw returns true when the source is classified as adult content.
// Uses the structured source.is_adult field (backed by the DB) rather than a name prefix.
// isNsfw
// 当源被分类为成人内容时返回 true.
// 使用结构化的 source.is_adult 字段 (由数据库支撑), 而非名称前缀.
function isNsfw(source: Source): boolean {
  return source.is_adult;
}

// sortSources puts non-adult sources first, preserving original order within each group.
// Stable sort is achieved by tagging each element with its original index before sorting.
// sortSources
// 把非成人源排前面, 组内保留原始顺序.
// 通过在排序前标记原始下标来实现稳定排序.
function sortSources(sources: Source[]): Source[] {
  return sources
    .map((src, origIdx) => ({ src, nsfw: isNsfw(src), origIdx }))
    .sort((a, b) => {
      if (a.nsfw === b.nsfw) return a.origIdx - b.origIdx;
      return a.nsfw ? 1 : -1;
    })
    .map((entry) => entry.src);
}

/**
 * SourcesPanel renders the full sources list with row actions and panel-level bulk actions.
 * SourcesPanel 渲染完整的视频源列表, 包含逐行操作和面板级批量操作.
 *
 * Renders a skeleton while loading, an error state on failure, and the table on success.
 * 加载中显示骨架屏, 失败时显示错误状态, 成功时显示表格.
 */
export function SourcesPanel() {
  const { t } = useTranslation("admin");
  const query = useSourcesQuery();
  const check = useCheckSourceMutation();
  const mutations = useSourcesMutations();

  // Memoised derived lists — each depends only on query.data?.sources so they
  // recompute only when the server data changes, not on every render.
  // 各派生列表仅依赖 query.data?.sources, 仅在服务器数据变化时重算, 不随每次渲染刷新.
  const sortedSources = useMemo(() => sortSources(query.data?.sources ?? []), [query.data?.sources]);
  // anyChecking drives the disabled state of the "check-all" button.
  // anyChecking 驱动 "全量探测" 按钮的禁用状态.
  const anyChecking = useMemo(() => sortedSources.some((s) => s.health === "checking"), [sortedSources]);
  // disabledSources is the target set for "enable all" — every source currently disabled.
  // disabledSources 是 "启用全部源" 的目标集合 — 所有当前禁用的源.
  const disabledSources = useMemo(() => sortedSources.filter((s) => !s.enabled), [sortedSources]);

  if (query.isLoading) return <AdminTableSkeleton />;
  if (query.isError) return <StatusState title={t("source.loadFailed")} tone="error" />;

  // enableAllSources uses the bulk endpoint so all rows update atomically in a single SQLite
  // transaction. A fan-out of N concurrent PUTs raced against the WAL writer lock and
  // failed with SQLITE_BUSY for all but the first request.
  // enableAllSources
  // 走批量端点, 所有行在单次 SQLite 事务中原子更新.
  // 之前的散列 N 个并发 PUT 会撞 WAL 写锁, 除第一个外全部 SQLITE_BUSY 失败.
  async function enableAllSources() {
    const total = disabledSources.length;
    if (total === 0) {
      toast.info({ title: t("source.enableAllNone") });
      return;
    }
    try {
      await mutations.bulkSetEnabled.mutateAsync({
        ids: disabledSources.map((source) => source.id),
        enabled: true,
      });
      toast.success({ title: t("source.enableAllSuccess", { count: total }) });
    } catch (error) {
      toast.error({
        title: t("errors.saveFailed"),
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }

  // runCheckAll triggers a health probe for every source via the check-all endpoint.
  // runCheckAll
  // 通过 check-all 端点触发所有源的健康探测.
  function runCheckAll() {
    mutations.checkAll.mutate(undefined, {
      onError: (error) => {
        toast.error({
          title: t("errors.saveFailed"),
          description: error instanceof Error ? error.message : undefined,
        });
      },
    });
  }

  // runCheckOne triggers a health probe for a single source by id.
  // runCheckOne
  // 通过 id 触发单个源的健康探测.
  function runCheckOne(id: number) {
    check.mutate(id, {
      onError: (error) => {
        toast.error({
          title: t("errors.saveFailed"),
          description: error instanceof Error ? error.message : undefined,
        });
      },
    });
  }

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <h2>{t("source.heading")}</h2>
        <div className="row-actions">
          <Button type="button" variant="secondary" onClick={() => adminModalStore.getState().open({ kind: "source.import" })}>
            {t("source.importButton")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={runCheckAll}
            disabled={mutations.checkAll.isPending || anyChecking}
          >
            {(mutations.checkAll.isPending || anyChecking) ? t("source.checkAllPending") : t("source.checkAllButton")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={enableAllSources}
            title={t("source.enableAllTitle")}
            disabled={mutations.bulkSetEnabled.isPending || mutations.toggleEnabled.isPending}
          >
            {t("source.enableAllButton")}
          </Button>
          <Button type="button" variant="primary" onClick={() => adminModalStore.getState().open({ kind: "source.new" })}>
            {t("source.newButton")}
          </Button>
        </div>
      </div>
      <div className="admin-table">
        {sortedSources.map((source) => {
          const health = formatSourceHealth(source.health);
          const healthLabel =
            health.tone === "success"
              ? t("status.healthy")
              : health.tone === "danger"
                ? t("status.unhealthy")
                : source.health === "checking"
                  ? t("status.checking")
                  : t("status.unknown");
          const checking = source.health === "checking";
          const toggleVariant = source.enabled ? "warning" : "success";
          return (
            <div className="admin-row" key={source.id}>
              <div className="admin-row-main">
                <strong>{source.name}</strong>
                <span>{source.api}</span>
              </div>
              <div className="admin-row-status">
                {source.is_adult ? (
                  <span className="status-pill status-pill-on">{t("source.nsfwBadge")}</span>
                ) : null}
                <span className={`status-pill ${source.enabled ? "status-pill-on" : "status-pill-off"}`}>
                  {source.enabled ? t("status.enabled") : t("status.disabled")}
                </span>
                <span
                  className={`status-pill ${checking ? "status-pill-checking" : `tone-${health.tone}`}`}
                >
                  {healthLabel}
                </span>
                <OptionalDate value={source.last_check} />
              </div>
              <div className="admin-row-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => runCheckOne(source.id)}
                  disabled={checking}
                  aria-label={t("source.actionsAria.check", { name: source.name })}
                >
                  {t("source.checkButton")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => adminModalStore.getState().open({ kind: "source.edit", source })}
                  aria-label={t("source.actionsAria.edit", { name: source.name })}
                >
                  {t("source.editButton")}
                </Button>
                <Button
                  type="button"
                  variant={toggleVariant}
                  onClick={() => mutations.toggleEnabled.mutate(source)}
                  aria-label={source.enabled
                    ? t("source.actionsAria.disable", { name: source.name })
                    : t("source.actionsAria.enable", { name: source.name })}
                >
                  {source.enabled ? t("source.disableButton") : t("source.enableButton")}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => adminModalStore.getState().open({ kind: "source.delete", source })}
                  aria-label={t("source.actionsAria.delete", { name: source.name })}
                >
                  {t("source.deleteButton")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
