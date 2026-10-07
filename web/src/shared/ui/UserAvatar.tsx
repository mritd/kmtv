/**
 * UserAvatar — a signed-in user's avatar image, loaded with the bearer header.
 *
 * UserAvatar — 已登录用户的头像图片, 携带 bearer header 加载.
 *
 * Responsibilities / 职责:
 *   - Fetch the avatar through api.avatarImage, because /api/v1/avatar is protected and an <img>
 *     pointing at it carries no bearer header (it would 401 when anonymous access is off).
 *
 *     通过 api.avatarImage 获取头像: /api/v1/avatar 受保护, 直接指向它的 <img> 不带 bearer header
 *     (关闭匿名访问时会返回 401).
 *
 *   - Render nothing while loading, and `fallback` when there is no URL or loading fails.
 *
 *     加载中不渲染内容; 没有 URL 或加载失败时渲染 `fallback`.
 *
 * Key exports / 主要导出:
 *   UserAvatar, UserAvatarProps
 *
 * Callers / 调用方:
 *   app/AppLayout.tsx, account/AvatarField.tsx, admin/AdminPage.tsx
 */
import { useEffect, useState, type ReactNode } from "react";

import { useAPI } from "@/api/context";

/**
 * UserAvatarProps defines the public API of UserAvatar.
 *
 * UserAvatarProps 定义 UserAvatar 的公开 API.
 */
export interface UserAvatarProps {
  /** The user's `avatar` URL; versioned, so a new upload yields a new URL. / 用户的 `avatar` URL, 带版本, 新上传会得到新 URL. */
  url?: string;
  /** Shown when there is no URL or the image fails to load. / 没有 URL 或图片加载失败时显示. */
  fallback: ReactNode;
}

/**
 * UserAvatar renders the avatar as an object URL and revokes it when the URL changes or the
 * component unmounts.
 *
 * UserAvatar 以 object URL 渲染头像, 并在 URL 变化或组件卸载时释放它.
 */
export function UserAvatar({ url, fallback }: UserAvatarProps): React.JSX.Element | null {
  const api = useAPI();
  const [state, setState] = useState<{ url: string; src: string | null; failed: boolean } | null>(null);

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    let objectURL: string | null = null;
    api
      .avatarImage(url, controller.signal)
      .then((blob) => {
        objectURL = URL.createObjectURL(blob);
        setState({ url, src: objectURL, failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ url, src: null, failed: true });
      });
    return () => {
      controller.abort();
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [api, url]);

  if (!url) return <>{fallback}</>;
  // A state left over from a previous URL is ignored until the new one settles.
  //
  // 上一个 URL 留下的状态在新 URL 加载完成前会被忽略.
  const current = state?.url === url ? state : null;
  if (current?.failed) return <>{fallback}</>;
  if (!current?.src) return null;
  return <img src={current.src} alt="" />;
}
