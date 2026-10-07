/**
 * AvatarField.test.tsx — unit tests for the AvatarField component.
 *
 * AvatarField.test.tsx — AvatarField 组件的单元测试.
 *
 * Covers / 覆盖:
 *   - Initial render (avatar vs. initials).
 *   - File type validation (rejected types do not call uploadAvatar).
 *   - File size validation (files > 256 KB rejected client-side).
 *   - Successful upload updates auth snapshot.
 *   - Upload error surfaces toast message.
 *   - Delete button hidden when no avatar or the server's default avatar.
 *   - Successful delete removes avatar.
 *
 *   - 初始渲染 (头像或首字母).
 *   - 文件类型校验 (被拒绝的类型不调用 uploadAvatar).
 *   - 文件大小校验 (大于 256 KB 的文件在客户端被拒绝).
 *   - 成功上传后更新 auth 快照.
 *   - 上传失败时显示 toast 消息.
 *   - 无头像或为服务端默认头像时隐藏删除按钮.
 *   - 成功删除后移除头像.
 */
import { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ToastContainer } from "@/shared/ui/Toast";

import { APIProvider } from "@/api/context";
import { createMemoryTokenStore } from "@/api/tokenStore";
import { AuthProvider } from "@/auth/AuthContext";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { createMemoryThemeStore } from "@/theme/themes";
import { createTestAPI } from "@/test/testAPI";
import { MAX_AVATAR_BYTES, AvatarField } from "./AvatarField";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RenderOptions {
  hasAvatar?: boolean;
  defaultAvatar?: boolean;
  avatarFails?: boolean;
}

function renderAvatarField({ hasAvatar = false, defaultAvatar = false, avatarFails = false }: RenderOptions = {}) {
  const user = {
    id: 1,
    username: "testuser",
    role: "admin" as const,
    ...(hasAvatar ? { avatar: "/api/v1/avatar/testuser?v=1" } : {}),
    ...(defaultAvatar ? { avatar: "/api/v1/avatar/testuser?v=default-1", avatar_is_default: true } : {}),
  };
  const tokenStore = createMemoryTokenStore({
    accessToken: "tok",
    expiresAt: "2026-05-23T12:00:00Z",
    user,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const api = createTestAPI({
    avatarImage: vi.fn(async () => {
      if (avatarFails) throw new Error("401");
      return new Blob(["GIF89a"], { type: "image/gif" });
    }),
  });
  return {
    api,
    ...render(
      <APIProvider value={api}>
        <ThemeProvider store={createMemoryThemeStore()}>
          <AuthProvider api={api} tokenStore={tokenStore} queryClient={queryClient}>
            <MemoryRouter>
              <AvatarField />
            </MemoryRouter>
          </AuthProvider>
        </ThemeProvider>
      </APIProvider>,
    ),
  };
}

function makeFile(name: string, type: string, size: number): File {
  // Create a File with a realistic size by filling a Blob with zeros.
  //
  // 创建指定大小的 File, 用零填充 Blob.
  const content = new Uint8Array(size);
  return new File([content], name, { type });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AvatarField", () => {
  describe("when no avatar is set", () => {
    it("shows the username initial instead of an image", () => {
      renderAvatarField();
      // Username is "testuser" → initial "T".
      //
      // 用户名 "testuser" → 首字母 "T".
      expect(screen.getByText("T")).toBeInTheDocument();
      expect(screen.queryByRole("img")).toBeNull();
    });

    it("hides the delete button", () => {
      renderAvatarField();
      // Delete button should not be present when user has no avatar.
      //
      // 用户无头像时不应出现删除按钮.
      expect(screen.queryByRole("button", { name: /删除|delete/i })).toBeNull();
    });
  });

  describe("when an avatar is set", () => {
    it("loads the avatar with the API client and renders it as an object URL", async () => {
      const { api, container } = renderAvatarField({ hasAvatar: true });
      // The avatar route is protected, so the image comes from api.avatarImage (bearer header),
      // not from an <img> pointing at the route. alt="" plus aria-hidden means a DOM query.
      //
      // 头像接口受保护, 因此图片来自 api.avatarImage (带 bearer header), 而不是直接指向接口的 <img>.
      // alt="" 且有 aria-hidden, 因此直接查询 DOM.
      await waitFor(() => {
        expect(container.querySelector<HTMLImageElement>("img")?.src).toMatch(/^blob:/);
      });
      expect(api.avatarImage).toHaveBeenCalledWith("/api/v1/avatar/testuser?v=1", expect.anything());
    });

    it("falls back to the initial when the avatar fails to load", async () => {
      const { container } = renderAvatarField({ hasAvatar: true, avatarFails: true });
      await waitFor(() => {
        expect(container.querySelector(".avatar-field-initial")?.textContent).toBe("T");
      });
      expect(container.querySelector("img")).toBeNull();
    });

    it("shows the delete button", () => {
      renderAvatarField({ hasAvatar: true });
      // Delete button must be present when user already has an avatar.
      //
      // 用户已有头像时必须出现删除按钮.
      expect(screen.getByRole("button", { name: /删除|delete/i })).toBeInTheDocument();
    });
  });

  describe("when the server's default avatar is set", () => {
    it("shows the default image without a delete button", async () => {
      const { api, container } = renderAvatarField({ defaultAvatar: true });
      await waitFor(() => {
        expect(container.querySelector("img")).not.toBeNull();
      });
      expect(api.avatarImage).toHaveBeenCalledWith("/api/v1/avatar/testuser?v=default-1", expect.anything());
      expect(screen.queryByRole("button", { name: /删除|delete/i })).toBeNull();
    });
  });

  describe("file validation", () => {
    it("rejects files with disallowed MIME types without calling uploadAvatar", async () => {
      const user = userEvent.setup();
      const { api } = renderAvatarField();
      const uploadSpy = vi.spyOn(api, "uploadAvatar");

      const uploadBtn = screen.getByRole("button", { name: /上传|upload/i });
      // Simulate file input change directly since we cannot open the native file picker.
      //
      // 直接模拟 file input change, 因为无法打开原生文件选择器.
      const input = document.querySelector<HTMLInputElement>("input[type='file']")!;
      await user.upload(input, makeFile("test.txt", "text/plain", 1024));

      expect(uploadSpy).not.toHaveBeenCalled();
      uploadBtn; // keep reference
    });

    it("rejects files larger than MAX_AVATAR_BYTES without calling uploadAvatar", async () => {
      const user = userEvent.setup();
      const { api } = renderAvatarField();
      const uploadSpy = vi.spyOn(api, "uploadAvatar");

      const input = document.querySelector<HTMLInputElement>("input[type='file']")!;
      // One byte over the limit.
      //
      // 超出限制一字节.
      await user.upload(input, makeFile("big.png", "image/png", MAX_AVATAR_BYTES + 1));

      expect(uploadSpy).not.toHaveBeenCalled();
    });

    it("accepts a valid PNG within the size limit and calls uploadAvatar", async () => {
      const user = userEvent.setup();
      const { api } = renderAvatarField();
      const uploadSpy = vi.spyOn(api, "uploadAvatar");

      const input = document.querySelector<HTMLInputElement>("input[type='file']")!;
      // Exactly at the limit (boundary value).
      //
      // 恰好在限制边界.
      await user.upload(input, makeFile("ok.png", "image/png", MAX_AVATAR_BYTES));

      expect(uploadSpy).toHaveBeenCalledOnce();
    });
  });

  describe("upload success", () => {
    it("calls uploadAvatar and updates auth snapshot on success", async () => {
      const user = userEvent.setup();
      // Override uploadAvatar to return the same test user (testuser) with a new avatar URL.
      // Avoids a false-identity mismatch where the default mock returns "admin" instead of "testuser".
      //
      // 覆盖 uploadAvatar 返回相同测试用户 (testuser) 并带新头像 URL.
      // 避免默认 mock 返回 "admin" 而不是 "testuser" 导致的身份不匹配.
      const api = createTestAPI({
        uploadAvatar: async () => ({ id: 1, username: "testuser", role: "admin", avatar: "/api/v1/avatar/testuser" }),
      });
      const tokenStore = createMemoryTokenStore({
        accessToken: "tok",
        expiresAt: "2026-05-23T12:00:00Z",
        user: { id: 1, username: "testuser", role: "admin" },
      });
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

      const { container } = render(
        <APIProvider value={api}>
          <ThemeProvider store={createMemoryThemeStore()}>
            <AuthProvider api={api} tokenStore={tokenStore} queryClient={queryClient}>
              <MemoryRouter>
                <AvatarField />
              </MemoryRouter>
            </AuthProvider>
          </ThemeProvider>
        </APIProvider>,
      );

      const input = document.querySelector<HTMLInputElement>("input[type='file']")!;
      await user.upload(input, makeFile("avatar.jpg", "image/jpeg", 1024));

      // After successful upload the avatar image should appear (queried via DOM since alt="" + aria-hidden).
      //
      // 成功上传后头像图片应出现 (因 alt="" + aria-hidden 使用 DOM 查询).
      await waitFor(() => {
        const img = container.querySelector<HTMLImageElement>("img");
        expect(img?.src).toMatch(/^blob:/);
      });
    });
  });

  describe("upload error", () => {
    it("shows an error toast when uploadAvatar rejects", async () => {
      const user = userEvent.setup();
      const api = createTestAPI({
        uploadAvatar: async () => { throw new Error("Server error"); },
      });
      const tokenStore = createMemoryTokenStore({
        accessToken: "tok",
        expiresAt: "2026-05-23T12:00:00Z",
        user: { id: 1, username: "testuser", role: "admin" },
      });
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

      render(
        <APIProvider value={api}>
          <ThemeProvider store={createMemoryThemeStore()}>
            <AuthProvider api={api} tokenStore={tokenStore} queryClient={queryClient}>
              <MemoryRouter>
                <AvatarField />
                {/* ToastContainer must be present for toast messages to render in the DOM. */}
                {/* ToastContainer 必须存在, toast 消息才能在 DOM 中渲染. */}
                <ToastContainer />
              </MemoryRouter>
            </AuthProvider>
          </ThemeProvider>
        </APIProvider>,
      );

      const input = document.querySelector<HTMLInputElement>("input[type='file']")!;
      await user.upload(input, makeFile("fail.png", "image/png", 1024));

      // Error toast title from zh locale: account.avatar.uploadFailed.
      //
      // 错误 toast 标题来自 zh locale: account.avatar.uploadFailed.
      await screen.findByText("头像上传失败");
    });
  });

  describe("delete avatar", () => {
    it("calls deleteAvatar and removes the avatar image on success", async () => {
      const user = userEvent.setup();
      // deleteAvatar returns user without avatar.
      //
      // deleteAvatar 返回无头像的用户.
      const api = createTestAPI({
        deleteAvatar: async () => ({ id: 1, username: "testuser", role: "admin" }),
      });
      const tokenStore = createMemoryTokenStore({
        accessToken: "tok",
        expiresAt: "2026-05-23T12:00:00Z",
        user: { id: 1, username: "testuser", role: "admin", avatar: "/api/v1/avatar/testuser" },
      });
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

      render(
        <APIProvider value={api}>
          <ThemeProvider store={createMemoryThemeStore()}>
            <AuthProvider api={api} tokenStore={tokenStore} queryClient={queryClient}>
              <MemoryRouter>
                <AvatarField />
              </MemoryRouter>
            </AuthProvider>
          </ThemeProvider>
        </APIProvider>,
      );

      const deleteBtn = screen.getByRole("button", { name: /删除|delete/i });
      await user.click(deleteBtn);

      // After deletion, the initials placeholder replaces the image.
      //
      // 删除后, 首字母占位符替代图片.
      await screen.findByText("T");
      // The img element should be gone from the DOM.
      //
      // img 元素应从 DOM 中消失.
      expect(document.querySelector("img")).toBeNull();
    });
  });
});
