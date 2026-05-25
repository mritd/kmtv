/**
 * SourceForm tests — verifies the is_adult toggle is wired into create and edit payloads.
 * SourceForm 测试 — 验证 is_adult 开关已接入新建与编辑请求体.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { APIProvider } from "@/api/context";
import type { Source } from "@/api/types";
import { createTestAPI } from "@/test/testAPI";

import { SourceForm } from "../SourceForm";

const existingSource: Source = {
  id: 5,
  key: "src-x",
  name: "Source X",
  api: "https://x.example",
  detail: "",
  enabled: true,
  is_adult: false,
  searchable: true,
  comment: "",
  health: "healthy",
  last_check: "",
  created_at: "",
  updated_at: "",
};

function renderForm(
  overrides: Partial<Parameters<typeof createTestAPI>[0]>,
  props: { source?: Source } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const api = createTestAPI(overrides);
  render(
    <APIProvider value={api}>
      <QueryClientProvider client={queryClient}>
        <SourceForm source={props.source} onDone={() => undefined} />
      </QueryClientProvider>
    </APIProvider>,
  );
}

describe("SourceForm is_adult toggle", () => {
  it("sends is_adult=true in the create payload when marked NSFW", async () => {
    const user = userEvent.setup();
    const createSource = vi.fn(async () => existingSource);
    renderForm({ createSource });

    await user.type(screen.getByLabelText("Key"), "src-new");
    await user.type(screen.getByLabelText("名称"), "New Source");
    await user.type(screen.getByLabelText("API URL"), "https://new.example");
    await user.click(screen.getByLabelText("标记为 NSFW 内容"));
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(createSource).toHaveBeenCalledTimes(1);
    expect(createSource).toHaveBeenCalledWith(
      expect.objectContaining({ key: "src-new", name: "New Source", is_adult: true }),
    );
  });

  it("initializes the toggle from the source and sends the change in the update payload", async () => {
    const user = userEvent.setup();
    const updateSource = vi.fn(async () => undefined);
    renderForm({ updateSource }, { source: existingSource });

    const toggle = screen.getByLabelText<HTMLInputElement>("标记为 NSFW 内容");
    expect(toggle.checked).toBe(false);
    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(updateSource).toHaveBeenCalledTimes(1);
    expect(updateSource).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ name: "Source X", is_adult: true }),
    );
  });
});
