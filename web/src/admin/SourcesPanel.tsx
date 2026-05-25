/**
 * SourcesPanel — admin panel for managing all configured video sources.
 * SourcesPanel — 管理所有已配置视频源的管理面板.
 *
 * Responsibilities / 职责:
 *   - List sources sorted: non-NSFW first, then NSFW, both groups preserving server order.
 *     按顺序展示源: 非 NSFW 在前, NSFW 在后, 组内保持服务器顺序.
 *   - Provide per-row actions: check health, edit, enable/disable, delete.
 *     提供逐行操作: 探测健康、编辑、启用/禁用、删除.
 *   - Provide bulk actions: check-all, bulk-enable-NSFW, import, new.
 *     提供批量操作: 全量探测、批量启用 NSFW、导入、新建.
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

// NSFW_PREFIX is the conventional emoji prefix that marks adult-content sources.
// Centralised here so sortSources and isNsfw both use the same sentinel.
// NSFW_PREFIX 是标记成人内容源的约定前缀 emoji.
// 集中定义让 sortSources 和 isNsfw 使用同一哨兵值.
const NSFW_PREFIX = "🔞";

// isNsfw returns true when the source name begins with the NSFW emoji prefix.
// isNsfw
// 当源名称以 NSFW emoji 前缀开头时返回 true.
function isNsfw(source: Source): boolean {
  return source.name.startsWith(NSFW_PREFIX);
}

// sortSources puts non-NSFW sources first, preserving original order within each group.
// Stable sort is achieved by tagging each element with its original index before sorting.
// sortSources
// 把非 NSFW 源排前面, 组内保留原始顺序.
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
  // nsfwDisabled is the target set for "enable all NSFW" — only sources that are NSFW AND disabled.
  // nsfwDisabled 是 "启用全部 NSFW" 的目标集合 — 仅 NSFW 且当前禁用的源.
  const nsfwDisabled = useMemo(() => sortedSources.filter((s) => isNsfw(s) && !s.enabled), [sortedSources]);

  if (query.isLoading) return <AdminTableSkeleton />;
  if (query.isError) return <StatusState title={t("source.loadFailed")} tone="error" />;

  // enableAllNsfw uses the bulk endpoint so all rows update atomically in a single SQLite
  // transaction. A fan-out of N concurrent PUTs raced against the WAL writer lock and
  // failed with SQLITE_BUSY for all but the first request.
  // enableAllNsfw
  // 走批量端点, 所有行在单次 SQLite 事务中原子更新.
  // 之前的散列 N 个并发 PUT 会撞 WAL 写锁, 除第一个外全部 SQLITE_BUSY 失败.
  async function enableAllNsfw() {
    const total = nsfwDisabled.length;
    if (total === 0) {
      toast.info({ title: t("source.enableNsfwNone") });
      return;
    }
    try {
      await mutations.bulkSetEnabled.mutateAsync({
        ids: nsfwDisabled.map((source) => source.id),
        enabled: true,
      });
      toast.success({ title: t("source.enableNsfwSuccess", { count: total }) });
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
            onClick={enableAllNsfw}
            title={t("source.enableNsfwTitle")}
            disabled={mutations.bulkSetEnabled.isPending || mutations.toggleEnabled.isPending}
          >
            {t("source.enableNsfwButton")}
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
