import { beforeEach, describe, expect, test } from "vitest";

import { adminModalStore } from "../adminModalStore";

beforeEach(() => {
  adminModalStore.getState().close();
});

const sampleSource = {
  id: 1,
  key: "k",
  name: "n",
  api: "",
  detail: "",
  enabled: true,
  searchable: true,
  comment: "",
  health: "healthy" as const,
  last_check: "",
  created_at: "",
  updated_at: "",
};

describe("adminModalStore", () => {
  test("open sets current payload", () => {
    adminModalStore.getState().open({ kind: "source.new" });
    expect(adminModalStore.getState().current?.kind).toBe("source.new");
  });

  test("open replaces current payload", () => {
    adminModalStore.getState().open({ kind: "source.new" });
    adminModalStore.getState().open({ kind: "source.edit", source: sampleSource });
    const current = adminModalStore.getState().current;
    expect(current?.kind).toBe("source.edit");
    if (current?.kind === "source.edit") {
      expect(current.source.id).toBe(1);
    }
  });

  test("close clears the payload", () => {
    adminModalStore.getState().open({ kind: "subscription.new" });
    adminModalStore.getState().close();
    expect(adminModalStore.getState().current).toBeNull();
  });
});
