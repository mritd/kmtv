// AuthenticatedAvatarImage tests — covers happy path, fetch failure, and btoa-absent encoder.
// AuthenticatedAvatarImage 测试 — 覆盖正常路径、拉取失败与无 btoa 情况下的编码.

import { render, waitFor } from "@testing-library/react-native";
import React from "react";

import type { APIClient } from "@/api/client";

import { AuthenticatedAvatarImage } from "./AuthenticatedAvatarImage";

describe("AuthenticatedAvatarImage", () => {
  it("fetches the path through client.getBlob and renders an Image source", async () => {
    const data = new Uint8Array([0xff, 0xd8, 0xff]).buffer;
    const client = { getBlob: jest.fn(async () => data) } as unknown as APIClient;
    const { getByTestId } = render(<AuthenticatedAvatarImage apiClient={client} path="/api/v1/avatar/u" />);
    await waitFor(() => {
      expect(client.getBlob).toHaveBeenCalledWith("/avatar/u");
      const img = getByTestId("avatar-image");
      const src = img.props.source as { uri: string };
      expect(src.uri).toContain("data:image/jpeg;base64,");
    });
  });

  it("renders fallback when fetch fails", async () => {
    const client = { getBlob: jest.fn(async () => { throw new Error("boom"); }) } as unknown as APIClient;
    const { getByTestId } = render(<AuthenticatedAvatarImage apiClient={client} path="/api/v1/avatar/u" />);
    await waitFor(() => {
      expect(getByTestId("avatar-fallback")).toBeTruthy();
    });
  });

  it("renders fallback when apiClient is null or path is empty", async () => {
    const { getByTestId, rerender } = render(<AuthenticatedAvatarImage apiClient={null} path="/api/v1/avatar/u" />);
    expect(getByTestId("avatar-fallback")).toBeTruthy();
    const client = { getBlob: jest.fn() } as unknown as APIClient;
    rerender(<AuthenticatedAvatarImage apiClient={client} path={undefined} />);
    expect(getByTestId("avatar-fallback")).toBeTruthy();
    expect(client.getBlob).not.toHaveBeenCalled();
  });

  it("encodes without depending on global.btoa", async () => {
    // Hermes on RN 0.85 does not reliably ship btoa; the implementation must NOT call it.
    // RN 0.85 的 Hermes 不一定提供 btoa, 实现禁止依赖该全局.
    const original = (globalThis as { btoa?: unknown }).btoa;
    (globalThis as { btoa?: unknown }).btoa = undefined;
    try {
      // 0xFF 0xD8 0xFF -> base64 "/9j/" — a stable signal that our encoder ran.
      const data = new Uint8Array([0xff, 0xd8, 0xff]).buffer;
      const client = { getBlob: jest.fn(async () => data) } as unknown as APIClient;
      const { getByTestId } = render(<AuthenticatedAvatarImage apiClient={client} path="/api/v1/avatar/u" />);
      await waitFor(() => {
        const img = getByTestId("avatar-image");
        const src = img.props.source as { uri: string };
        expect(src.uri).toMatch(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/);
        expect(src.uri).toContain("/9j/");
      });
    } finally {
      (globalThis as { btoa?: unknown }).btoa = original;
    }
  });
});
