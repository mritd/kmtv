import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { APIProvider } from "@/api/context";
import type { APIClient } from "@/api/client";
import type { Source } from "@/api/types";
import { createTestAPI } from "@/test/testAPI";
import { adminModalStore, type AdminModalPayload } from "@/store/adminModalStore";

import { AdminModal } from "../AdminModal";

const sampleSource: Source = {
  id: 1,
  key: "source-a",
  name: "Source A",
  api: "https://a.example",
  detail: "",
  enabled: true,
  searchable: true,
  comment: "",
  health: "healthy",
  last_check: "",
  created_at: "",
  updated_at: "",
};

function renderModal(api: APIClient = createTestAPI(), payload: AdminModalPayload | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  if (payload) adminModalStore.setState({ current: payload });
  return render(
    <APIProvider value={api}>
      <QueryClientProvider client={client}>
        <AdminModal />
      </QueryClientProvider>
    </APIProvider>,
  );
}

describe("AdminModal", () => {
  it("renders nothing when payload is null", () => {
    renderModal();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the source.new form with one dialog role", () => {
    renderModal(createTestAPI(), { kind: "source.new" });
    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "新增视频源" })).toBeInTheDocument();
  });

  it("renders the source.edit form pre-filled from the payload source", () => {
    renderModal(createTestAPI(), { kind: "source.edit", source: sampleSource });
    expect(screen.getByRole("heading", { name: "编辑视频源" })).toBeInTheDocument();
    // Labels now come from i18n (admin.source.form.*).
    // 标签来自 i18n.
    expect(screen.getByLabelText("名称")).toHaveValue("Source A");
    expect(screen.getByLabelText("Key")).toBeDisabled();
  });

  it("source.delete renders ConfirmDialog (single dialog, not nested) and calls deleteSource", async () => {
    const user = userEvent.setup();
    const deleteSource = vi.fn(async () => undefined);
    const api = createTestAPI({ deleteSource });
    renderModal(api, { kind: "source.delete", source: sampleSource });

    const dialogs = screen.getAllByRole("dialog");
    // ConfirmDialog renders its own role=dialog; no nested Modal wrapper.
    // ConfirmDialog
    // 自带 dialog, 未嵌套 Modal.
    expect(dialogs).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(deleteSource).toHaveBeenCalledWith(1));
  });

  it("source.new form submission calls createSource then closes the modal", async () => {
    const user = userEvent.setup();
    const createSource = vi.fn(async () => sampleSource);
    const api = createTestAPI({ createSource });
    renderModal(api, { kind: "source.new" });

    await user.type(screen.getByLabelText("Key"), "new-key");
    await user.type(screen.getByLabelText("名称"), "New Source");
    await user.type(screen.getByLabelText("API URL"), "https://new.example");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(createSource).toHaveBeenCalledTimes(1));
    expect(createSource).toHaveBeenLastCalledWith(expect.objectContaining({ key: "new-key", name: "New Source", api: "https://new.example" }));
    await waitFor(() => expect(adminModalStore.getState().current).toBeNull());
  });

  it("source.new form blocks submit when required fields are empty", async () => {
    const user = userEvent.setup();
    const createSource = vi.fn(async () => sampleSource);
    const api = createTestAPI({ createSource });
    renderModal(api, { kind: "source.new" });

    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(createSource).not.toHaveBeenCalled();
    expect(screen.getByText("Key 不能为空.")).toBeInTheDocument();
  });

  it("source.import parses JSON and calls importSources", async () => {
    const user = userEvent.setup();
    const importSources = vi.fn(async () => ({ imported: 1 }));
    const api = createTestAPI({ importSources });
    renderModal(api, { kind: "source.import" });

    // user-event treats `{` as a special key, so use clipboard paste to insert raw JSON.
    // user-event
    // 把 `{` 视为特殊键, 改用 clipboard paste 输入原始 JSON.
    const textarea = screen.getByLabelText("Import JSON payload");
    textarea.focus();
    await user.paste('{"sources":[]}');
    await user.click(screen.getByRole("button", { name: "导入" }));

    await waitFor(() => expect(importSources).toHaveBeenCalledTimes(1));
    expect(importSources).toHaveBeenLastCalledWith({ sources: [] });
  });

  it("user.password shows live mismatch error and clears it when passwords match", async () => {
    const user = userEvent.setup();
    renderModal(createTestAPI(), {
      kind: "user.password",
      user: { id: 1, username: "alice", role: "admin", created_at: "", updated_at: "" },
    });
    const newPwd = screen.getByLabelText("新密码");
    const confirmPwd = screen.getByLabelText("确认密码");

    await user.type(newPwd, "secret123");
    await user.type(confirmPwd, "wrong");

    expect(await screen.findByText("两次密码不一致.")).toBeInTheDocument();

    await user.clear(confirmPwd);
    await user.type(confirmPwd, "secret123");

    await waitFor(() => expect(screen.queryByText("两次密码不一致.")).toBeNull());
  });

  it("source.import shows a parse error for malformed JSON", async () => {
    const user = userEvent.setup();
    const importSources = vi.fn();
    const api = createTestAPI({ importSources });
    renderModal(api, { kind: "source.import" });

    await user.type(screen.getByLabelText("Import JSON payload"), "not json");
    await user.click(screen.getByRole("button", { name: "导入" }));

    expect(importSources).not.toHaveBeenCalled();
    expect(screen.getByText("JSON 解析失败.")).toBeInTheDocument();
  });
});
