// installGlobalErrorHandler tests: capture + idempotence + global fatal forwarding.
// installGlobalErrorHandler 测试: 捕获 + 幂等 + 全局致命转发.

import { clearErrorLog, loadErrorEntries } from "./errorLog";
import { __resetInstallGuard, installGlobalErrorHandler } from "./installGlobalErrorHandler";

describe("installGlobalErrorHandler", () => {
  let originalConsoleError: typeof console.error;
  let originalGlobalHandler: (err: Error, isFatal?: boolean) => void;

  beforeEach(() => {
    clearErrorLog();
    __resetInstallGuard();
    originalConsoleError = console.error;
    originalGlobalHandler = ErrorUtils.getGlobalHandler();
  });

  afterEach(() => {
    console.error = originalConsoleError;
    ErrorUtils.setGlobalHandler(originalGlobalHandler);
  });

  it("captures console.error invocations into the error log", () => {
    installGlobalErrorHandler();
    console.error("oops", new Error("kaboom"));
    const entries = loadErrorEntries();
    expect(entries[0]?.message).toContain("oops");
    expect(entries[0]?.message).toContain("kaboom");
  });

  it("is idempotent — second call does NOT double-capture", () => {
    installGlobalErrorHandler();
    installGlobalErrorHandler();
    console.error("once");
    expect(loadErrorEntries().length).toBe(1);
  });

  it("captures ErrorUtils.setGlobalHandler fatal errors", () => {
    // RN's jest preset wires a default global handler that rethrows. Replace it with a
    // silent handler BEFORE installing so our wrapper forwards into a no-op chain.
    // RN jest 默认 handler 会重抛; 先换成静默 handler 让转发链终结于 no-op.
    ErrorUtils.setGlobalHandler(() => undefined);
    installGlobalErrorHandler();
    const handler = ErrorUtils.getGlobalHandler();
    handler(new Error("fatal!"), true);
    const entries = loadErrorEntries();
    expect(entries[0]?.source).toBe("global");
    expect(entries[0]?.message).toContain("fatal!");
  });
});
