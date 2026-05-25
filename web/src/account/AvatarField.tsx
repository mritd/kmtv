/**
 * AvatarField — avatar upload / delete widget used inside the AccountPage profile form.
 * AvatarField — 在 AccountPage profile 表单中使用的头像上传/删除组件.
 *
 * Responsibilities / 职责:
 *   - Show the current avatar image, or the user's username initial when no avatar is set.
 *     显示当前头像图片, 无头像时显示用户名首字母.
 *   - Trigger a hidden <input type="file"> picker on upload button click.
 *     点击上传按钮时触发隐藏的 <input type="file"> 选择器.
 *   - Validate file type (JPEG / PNG / GIF / WebP) and size (≤ 256 KB) before upload.
 *     上传前校验文件类型 (JPEG / PNG / GIF / WebP) 与大小 (≤ 256 KB).
 *   - Upload via api.uploadAvatar and delete via api.deleteAvatar; refresh auth snapshot on success.
 *     通过 api.uploadAvatar 上传, api.deleteAvatar 删除; 成功后刷新 auth 快照.
 *   - Show pending state (disabling both buttons) while an operation is in flight.
 *     操作进行中时显示 pending 状态 (禁用两个按钮).
 *
 * Key exports / 主要导出:
 *   AvatarField, MAX_AVATAR_BYTES (re-exported for tests and callers)
 *
 * Callers / 调用方:
 *   account/AccountPage.tsx (inside the authenticated profile form)
 *
 * TIER 4 LOCKED — MAX_AVATAR_BYTES (256 KB) must not be changed without a backend deploy.
 * Tier 4 锁定 — MAX_AVATAR_BYTES (256 KB) 必须与后端同步修改.
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAPI } from "@/api/context";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/shared/ui/Button";
import { toast } from "@/shared/ui/Toast";

/**
 * MAX_AVATAR_BYTES mirrors the backend ceiling (256 KB) so the client can refuse obvious oversize
 * uploads early, before the HTTP round-trip, while still keeping the guard in sync with the server.
 * MAX_AVATAR_BYTES 与后端上限 (256 KB) 保持一致, 让客户端在 HTTP 往返前预先拦截明显过大的上传.
 *
 * TIER 4 LOCKED — value must match the backend avatar size limit.
 * Tier 4 锁定 — 此值必须与后端头像大小限制保持一致.
 */
export const MAX_AVATAR_BYTES = 256 * 1024;

// ALLOWED_TYPES lists the MIME types accepted by the avatar upload endpoint.
// ALLOWED_TYPES 列举头像上传端点接受的 MIME 类型.
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

/**
 * AvatarField renders the avatar preview, upload button, and optional delete button.
 * AvatarField 渲染头像预览、上传按钮和可选的删除按钮.
 *
 * The delete button is only shown when the user already has an avatar (`user.avatar` is truthy).
 * 仅当用户已有头像时 (`user.avatar` 为真值) 才显示删除按钮.
 */
export function AvatarField() {
  const { t } = useTranslation("account");
  const api = useAPI();
  const auth = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState<"upload" | "delete" | null>(null);

  const user = auth.user;
  const initial = user?.username?.slice(0, 1).toUpperCase() ?? "?";

  // pickFile delegates click to the hidden file input so the browser opens the native file picker.
  // We use a ref rather than an imperative DOM query to keep the component testable.
  // pickFile 将点击事件委托给隐藏的 file input, 触发浏览器原生文件选择器.
  // 使用 ref 而非命令式 DOM 查询, 以保持组件可测试性.
  function pickFile() {
    fileInputRef.current?.click();
  }

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset the input value so the same file can be re-selected after cancelling.
    // 重置 input 值, 允许取消后重新选择同一文件.
    event.target.value = "";
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error({ title: t("avatar.errorType") });
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error({ title: t("avatar.errorTooLarge") });
      return;
    }
    setPending("upload");
    try {
      const updated = await api.uploadAvatar(file);
      auth.updateUser(updated);
      toast.success({ title: t("avatar.uploadSuccess") });
    } catch (err) {
      toast.error({
        title: t("avatar.uploadFailed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setPending(null);
    }
  }

  async function onDelete() {
    // Guard: skip if user has no avatar; button should also be hidden in this state.
    // 防御: 用户无头像时跳过; 此状态下按钮也应隐藏.
    if (!user?.avatar) return;
    setPending("delete");
    try {
      const updated = await api.deleteAvatar();
      auth.updateUser(updated);
      toast.success({ title: t("avatar.deleteSuccess") });
    } catch (err) {
      toast.error({
        title: t("avatar.deleteFailed"),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="avatar-field">
      <div className="avatar-field-image" aria-hidden="true">
        {user?.avatar ? (
          <img src={user.avatar} alt="" />
        ) : (
          <span className="avatar-field-initial">{initial}</span>
        )}
      </div>
      <div className="avatar-field-body">
        <div className="avatar-field-actions">
          <Button type="button" variant="secondary" onClick={pickFile} disabled={pending !== null}>
            {pending === "upload" ? t("avatar.uploadPending") : t("avatar.uploadButton")}
          </Button>
          {user?.avatar ? (
            <Button type="button" variant="ghost" onClick={onDelete} disabled={pending !== null}>
              {pending === "delete" ? t("avatar.deletePending") : t("avatar.deleteButton")}
            </Button>
          ) : null}
        </div>
        <span className="avatar-field-hint">{t("avatar.hint")}</span>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_TYPES.join(",")}
        onChange={onFileChange}
        style={{ display: "none" }}
        aria-hidden="true"
      />
    </div>
  );
}
