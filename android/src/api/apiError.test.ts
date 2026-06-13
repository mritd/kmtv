// English. 中文.
// APIError discriminated-union tests.
// APIError 判别式联合类型测试.

import { APIError, localizedMessage } from "./apiError";

describe("APIError", () => {
  it("unauthorized maps to a stable message", () => {
    expect(localizedMessage({ kind: "unauthorized" })).toBe("Authentication required");
  });

  it("server passes through the upstream message", () => {
    expect(localizedMessage({ kind: "server", message: "boom" })).toBe("boom");
  });

  it("network and timeout have distinct messages", () => {
    expect(localizedMessage({ kind: "network" })).toBe("Network error");
    expect(localizedMessage({ kind: "timeout" })).toBe("Request timed out");
  });

  it("invalidURL is reported", () => {
    expect(localizedMessage({ kind: "invalidURL" })).toBe("Invalid server URL");
  });

  it("APIError.fromResponse converts 401 to unauthorized", async () => {
    const res = { status: 401, json: async () => ({ error: "expired" }) } as unknown as Response;
    const err = await APIError.fromResponse(res);
    expect(err.kind).toBe("unauthorized");
  });

  it("APIError.fromResponse converts 500 with body.error to server(message)", async () => {
    const res = { status: 500, json: async () => ({ error: "db down" }) } as unknown as Response;
    const err = await APIError.fromResponse(res);
    expect(err).toEqual({ kind: "server", message: "db down" });
  });

  it("APIError.fromResponse uses body.message when body.error missing", async () => {
    const res = { status: 500, json: async () => ({ message: "alt msg" }) } as unknown as Response;
    const err = await APIError.fromResponse(res);
    expect(err).toEqual({ kind: "server", message: "alt msg" });
  });

  it("APIError.fromResponse falls back to HTTP status when body is not JSON", async () => {
    const res = {
      status: 503,
      json: async () => { throw new Error("not json"); },
    } as unknown as Response;
    const err = await APIError.fromResponse(res);
    expect(err.kind).toBe("server");
    expect((err as { message: string }).message).toContain("503");
  });
});
