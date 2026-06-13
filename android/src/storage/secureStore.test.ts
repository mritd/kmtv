// Tests for the SecureStore wrapper used by the auth store.
// authStore 使用的 SecureStore 封装的测试.

import { clearToken, loadToken, saveToken } from "./secureStore";

describe("secureStore token helpers", () => {
  it("returns null before any token is saved", async () => {
    await clearToken();
    expect(await loadToken()).toBeNull();
  });

  it("round-trips a token value", async () => {
    await saveToken("abc-123");
    expect(await loadToken()).toBe("abc-123");
  });

  it("clears a previously saved token", async () => {
    await saveToken("xyz");
    await clearToken();
    expect(await loadToken()).toBeNull();
  });
});
