/**
 * AdminModal — single modal root that dispatches to the correct admin form or confirm dialog.
 * AdminModal — 单弹窗根节点, 根据当前 payload 调度到对应的管理表单或确认对话框.
 *
 * Responsibilities / 职责:
 *   - Subscribe to adminModalStore and render nothing when current === null.
 *     订阅 adminModalStore, current 为 null 时不渲染任何内容.
 *   - Dispatch on AdminModalPayload.kind to pick the right form or ConfirmDialog.
 *     根据 AdminModalPayload.kind 选择正确的表单或 ConfirmDialog.
 *   - Bind all mutation hooks once in AdminModalBody to avoid per-arm prop drilling.
 *     在 AdminModalBody 中统一绑定所有 mutation hook, 避免各分支逐层透传 props.
 *   - Call toast.error on mutate failure; close on success.
 *     mutate 失败时调用 toast.error; 成功时关闭弹窗.
 *
 * Key exports / 主要导出:
 *   AdminModal
 *
 * Callers / 调用方:
 *   admin/AdminPage.tsx (mounted once at the page level)
 *
 * AdminModalPayload is TIER 4 LOCKED — see adminModalStore.ts.
 * AdminModalPayload 为 Tier 4 锁定 — 见 adminModalStore.ts.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { Modal } from "@/shared/ui/Modal";
import { toast } from "@/shared/ui/Toast";
import { adminModalStore, type AdminModalPayload } from "@/store/adminModalStore";

import { ChangePasswordForm } from "./forms/ChangePasswordForm";
import { SourceForm } from "./forms/SourceForm";
import { SourceImportForm } from "./forms/SourceImportForm";
import { SubscriptionForm } from "./forms/SubscriptionForm";
import { UserForm } from "./forms/UserForm";
import { useSourcesMutations } from "./hooks/useSourcesMutations";
import { useSubscriptionsMutations } from "./hooks/useSubscriptionsMutations";
import { useUsersMutations } from "./hooks/useUsersMutations";

/**
 * AdminModal is the single modal outlet for all admin actions.
 * AdminModal 是所有管理操作的唯一弹窗出口.
 *
 * Renders nothing when no modal is active; delegates to AdminModalBody otherwise.
 * 无活动弹窗时不渲染; 否则委托给 AdminModalBody.
 */
export function AdminModal() {
  const current = useStore(adminModalStore, (s) => s.current);
  if (!current) return null;
  return <AdminModalBody payload={current} onClose={() => adminModalStore.getState().close()} />;
}

// FormShell wraps a form in the shared <Modal> with a consistent labelledBy id.
// Using a thin wrapper avoids repeating the same Modal props in every form arm.
// FormShell
// 用统一 labelledBy 将表单包裹在 <Modal> 中.
// 使用轻封装避免在每个分支重复相同的 Modal 属性.
function FormShell({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <Modal isOpen onClose={onClose} labelledBy="admin-modal-title">
      {children}
    </Modal>
  );
}

// AdminModalBody renders the correct form or confirm dialog based on payload.kind.
// All mutation hooks are initialised here once so each arm can call them without
// receiving them as props — this keeps the arms lean and the hook call count stable.
// AdminModalBody
// 根据 payload.kind 渲染对应的表单或确认对话框.
// 所有 mutation hook 在此统一初始化, 各分支直接调用而无需接受 props,
// 保持分支精简且 hook 调用次数稳定.
function AdminModalBody({ payload, onClose }: { payload: AdminModalPayload; onClose: () => void }): ReactNode {
  // Mutation hooks bound here so destructive arms can call them without prop drilling.
  // 销毁流程的 hook 在此绑定, 各分支无需透传.
  const { t } = useTranslation("admin");
  const sources = useSourcesMutations();
  const subscriptions = useSubscriptionsMutations();
  const users = useUsersMutations();

  switch (payload.kind) {
    case "source.new":
      return (
        <FormShell onClose={onClose}>
          <SourceForm onDone={onClose} />
        </FormShell>
      );
    case "source.edit":
      return (
        <FormShell onClose={onClose}>
          <SourceForm onDone={onClose} source={payload.source} />
        </FormShell>
      );
    case "source.delete": {
      return (
        <ConfirmDialog
          title={t("source.deleteTitle")}
          description={t("source.deleteConfirm", { name: payload.source.name })}
          confirmLabel={sources.remove.isPending ? t("source.deletePending") : t("source.deleteButton")}
          onCancel={onClose}
          onConfirm={() =>
            sources.remove.mutate(payload.source.id, {
              onSuccess: onClose,
              onError: (err) => {
                toast.error({
                  title: t("errors.deleteFailed"),
                  description: err instanceof Error ? err.message : undefined,
                });
              },
            })
          }
        />
      );
    }
    case "source.import":
      return (
        <FormShell onClose={onClose}>
          <SourceImportForm onDone={onClose} />
        </FormShell>
      );
    case "subscription.new":
      return (
        <FormShell onClose={onClose}>
          <SubscriptionForm onDone={onClose} />
        </FormShell>
      );
    case "subscription.edit":
      return (
        <FormShell onClose={onClose}>
          <SubscriptionForm onDone={onClose} subscription={payload.subscription} />
        </FormShell>
      );
    case "subscription.delete": {
      return (
        <ConfirmDialog
          title={t("subscription.deleteTitle")}
          description={t("subscription.deleteConfirm", { url: payload.subscription.url })}
          confirmLabel={subscriptions.remove.isPending ? t("subscription.deletePending") : t("subscription.deleteButton")}
          onCancel={onClose}
          onConfirm={() =>
            subscriptions.remove.mutate(payload.subscription.id, {
              onSuccess: onClose,
              onError: (err) => {
                toast.error({
                  title: t("errors.deleteFailed"),
                  description: err instanceof Error ? err.message : undefined,
                });
              },
            })
          }
        />
      );
    }
    case "user.new":
      return (
        <FormShell onClose={onClose}>
          <UserForm onDone={onClose} />
        </FormShell>
      );
    case "user.edit":
      return (
        <FormShell onClose={onClose}>
          <UserForm onDone={onClose} user={payload.user} />
        </FormShell>
      );
    case "user.delete": {
      return (
        <ConfirmDialog
          title={t("user.deleteTitle")}
          description={t("user.deleteConfirm", { username: payload.user.username })}
          confirmLabel={users.remove.isPending ? t("user.deletePending") : t("user.deleteButton")}
          onCancel={onClose}
          onConfirm={() =>
            users.remove.mutate(payload.user.id, {
              onSuccess: onClose,
              onError: (err) => {
                toast.error({
                  title: t("errors.deleteFailed"),
                  description: err instanceof Error ? err.message : undefined,
                });
              },
            })
          }
        />
      );
    }
    case "user.password":
      return (
        <FormShell onClose={onClose}>
          <ChangePasswordForm onDone={onClose} user={payload.user} />
        </FormShell>
      );
    default:
      return assertNever(payload);
  }
}

// assertNever is a TypeScript exhaustiveness guard.
// If a new AdminModalPayload variant is added without a matching switch arm,
// the compiler will surface a type error here rather than silently rendering nothing.
// assertNever
// 是 TypeScript 穷尽性守卫.
// 如果新增 AdminModalPayload 变体但未添加对应 switch 分支, 编译器会在此处报错而非静默忽略.
function assertNever(value: never): never {
  throw new Error(`Unhandled admin modal payload: ${JSON.stringify(value)}`);
}
