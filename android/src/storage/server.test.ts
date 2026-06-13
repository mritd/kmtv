// Tests for the persisted current-server URL helpers.
// 持久化当前服务器 URL helper 的测试.

import { clearServerURL, loadServerURL, saveServerURL } from "./server";

describe("server URL persistence", () => {
  beforeEach(() => {
    clearServerURL();
  });

  it("returns null before any URL is saved", () => {
    expect(loadServerURL()).toBeNull();
  });

  it("round-trips a server URL", () => {
    saveServerURL("https://kmtv.example.com");
    expect(loadServerURL()).toBe("https://kmtv.example.com");
  });

  it("clears the saved URL", () => {
    saveServerURL("https://kmtv.example.com");
    clearServerURL();
    expect(loadServerURL()).toBeNull();
  });
});
