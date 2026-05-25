/**
 * UserForm tests — verifies the adult-content toggle is wired into create and edit payloads.
 * UserForm 测试 — 验证成人内容开关已接入新建与编辑请求体.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { APIProvider } from "@/api/context";
import type { AdminUser } from "@/api/types";
import { createTestAPI } from "@/test/testAPI";

import { UserForm } from "../UserForm";

function renderForm(
  overrides: Partial<Parameters<typeof createTestAPI>[0]>,
  props: { user?: AdminUser } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const api = createTestAPI(overrides);
  render(
    <APIProvider value={api}>
      <QueryClientProvider client={queryClient}>
        <UserForm user={props.user} onDone={() => undefined} />
      </QueryClientProvider>
    </APIProvider>,
  );
}

describe("UserForm adult-content toggle", () => {
  it("sends allow_adult_content=true in the create payload when toggled on", async () => {
    const user = userEvent.setup();
    const createUser = vi.fn(async (payload) => ({
      id: 1,
      username: payload.username,
      role: payload.role,
      allow_adult_content: payload.allow_adult_content ?? false,
    }));
    renderForm({ createUser });

    await user.type(screen.getByLabelText("用户名"), "alice");
    await user.type(screen.getByLabelText("密码"), "secret");
    await user.click(screen.getByLabelText("允许访问 NSFW 内容"));
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(createUser).toHaveBeenCalledTimes(1);
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ username: "alice", allow_adult_content: true }),
    );
  });

  it("initializes the toggle from the user and sends the change in the update payload", async () => {
    const user = userEvent.setup();
    const updateUser = vi.fn(async () => undefined);
    const existing: AdminUser = { id: 7, username: "bob", role: "user", allow_adult_content: true };
    renderForm({ updateUser }, { user: existing });

    // Edit mode starts with the toggle on (mirrors existing.allow_adult_content); turn it off.
    // 编辑模式开关初始为开 (跟随 existing.allow_adult_content); 关掉它.
    const toggle = screen.getByLabelText<HTMLInputElement>("允许访问 NSFW 内容");
    expect(toggle.checked).toBe(true);
    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ username: "bob", role: "user", allow_adult_content: false }),
    );
  });
});
