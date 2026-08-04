// Inline confirmation dialog rendered inside the current layout (not a portal).
// 内联确认对话框, 渲染于当前布局内 (非 portal).
//
// Exports: ConfirmDialog.
// Callers: admin panels that need a destructive-action guard before firing mutations.
// Note: wrapping in a Modal is the caller's responsibility when overlay behaviour is needed.
// 注意: 需要遮罩行为时由调用方包入 Modal.

import { Button } from "./Button";

// ConfirmDialog presents a title, optional description, and confirm / cancel actions.
// ConfirmDialog 显示标题、可选描述以及确认 / 取消操作.
// Confirm is always rendered as "danger" variant to signal a destructive action.
// 确认按钮始终为 "danger" 变体, 提示破坏性操作.
//
// Both labels are required. They used to default to "确认" / "取消", which put a
// hardcoded Chinese string one missing prop away from the screen — and every caller
// already passed confirmLabel while none passed cancelLabel, so English users were
// reading "取消" on every delete dialog. A presentational component cannot translate
// for its callers, so it asks them for the text instead.
// 两个标签都是必填. 此前它们默认为 "确认" / "取消", 使硬编码中文只差一个未传的 prop
// 就会出现在界面上 — 而所有调用方都传了 confirmLabel, 却没有一个传 cancelLabel,
// 于是英文用户在每个删除对话框上看到的都是 "取消".
// 纯展示组件无法替调用方翻译, 因此改为要求调用方提供文案.
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm(): void;
  onCancel(): void;
}): React.JSX.Element {
  return (
    <div className="confirm-backdrop" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
        <div className="row-actions">
          <Button type="button" variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}
