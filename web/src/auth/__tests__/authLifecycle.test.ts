import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";

import { registerUserScopedReset, resetUserScopedState } from "../authLifecycle";

describe("resetUserScopedState", () => {
  test("cancels and clears React Query, resets user-scoped UI stores, preserves preferences", async () => {
    const queryClient = new QueryClient();
    await queryClient.prefetchQuery({ queryKey: ["admin", "sources"], queryFn: async () => ({ sources: [{ id: 1 }] }) });
    expect(queryClient.getQueryData(["admin", "sources"])).toBeTruthy();

    const searchReset = vi.fn();
    const detailReset = vi.fn();
    const navReset = vi.fn();
    const modalReset = vi.fn();
    const themeReset = vi.fn();
    const i18nReset = vi.fn();

    await resetUserScopedState(queryClient, {
      reason: "logout",
      stores: {
        userScoped: [searchReset, detailReset, navReset, modalReset],
        devicePreferences: [themeReset, i18nReset],
      },
    });

    expect(queryClient.getQueryData(["admin", "sources"])).toBeUndefined();
    expect(searchReset).toHaveBeenCalledTimes(1);
    expect(detailReset).toHaveBeenCalledTimes(1);
    expect(navReset).toHaveBeenCalledTimes(1);
    expect(modalReset).toHaveBeenCalledTimes(1);
    expect(themeReset).not.toHaveBeenCalled();
    expect(i18nReset).not.toHaveBeenCalled();
  });

  test("awaits cancelQueries before clear so settled responses cannot repopulate cache", async () => {
    const queryClient = new QueryClient();
    const events: string[] = [];
    // Spy on cancelQueries to delay resolution and record ordering.
    // 监听 cancelQueries 推迟其 promise 解析以验证顺序.
    const originalCancel = queryClient.cancelQueries.bind(queryClient);
    vi.spyOn(queryClient, "cancelQueries").mockImplementation(async (filters) => {
      events.push("cancel:start");
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      await originalCancel(filters);
      events.push("cancel:end");
    });
    vi.spyOn(queryClient, "clear").mockImplementation(() => {
      events.push("clear");
    });

    await resetUserScopedState(queryClient, {
      reason: "logout",
      stores: { userScoped: [() => events.push("userScoped")], devicePreferences: [] },
    });

    expect(events).toEqual(["cancel:start", "cancel:end", "clear", "userScoped"]);
  });
});

describe("registerUserScopedReset", () => {
  test("invokes registered callback during resetUserScopedState", async () => {
    // Register a callback into the global registry, then verify it is called by the lifecycle.
    // 向全局注册表注册回调, 验证生命周期调用时它被执行.
    const queryClient = new QueryClient();
    const fn = vi.fn();
    const unregister = registerUserScopedReset(fn);

    await resetUserScopedState(queryClient, { reason: "logout" });

    expect(fn).toHaveBeenCalledTimes(1);
    unregister();
  });

  test("unregister removes the callback so subsequent resets skip it", async () => {
    // After unregister the callback must NOT be called on the next transition.
    // 注销后的下一次身份切换中, 该回调不得被调用.
    const queryClient = new QueryClient();
    const fn = vi.fn();
    const unregister = registerUserScopedReset(fn);
    unregister();

    await resetUserScopedState(queryClient, { reason: "logout" });

    expect(fn).not.toHaveBeenCalled();
  });

  test("calling unregister twice is a no-op and does not throw", () => {
    // Defensive: double-unregister must not corrupt the registry or throw.
    // 防御: 双重注销不得破坏注册表或抛出异常.
    const fn = vi.fn();
    const unregister = registerUserScopedReset(fn);
    expect(() => {
      unregister();
      unregister();
    }).not.toThrow();
  });

  test("reset still runs for all clear reasons (unauthorized / expired / external)", async () => {
    // All AuthClearReason values must trigger the same cancel+clear+userScoped sequence.
    // reason 本身是 void 使用的透传参数, 所有清除原因均应触发同一套 cancel+clear+用户作用域重置流程.
    const queryClient = new QueryClient();
    await queryClient.prefetchQuery({ queryKey: ["k"], queryFn: async () => 42 });

    const fn = vi.fn();
    await resetUserScopedState(queryClient, {
      reason: "unauthorized",
      stores: { userScoped: [fn], devicePreferences: [] },
    });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(["k"])).toBeUndefined();
  });

  test("devicePreferences callbacks are never called during identity transitions", async () => {
    // Regardless of reason, devicePreferences (theme/language) must survive user switches.
    // 无论何种原因, 设备偏好 (主题/语言) 在用户切换中均须保留.
    const queryClient = new QueryClient();
    const themeReset = vi.fn();
    const i18nReset = vi.fn();

    for (const reason of ["logout", "unauthorized", "expired", "external"] as const) {
      await resetUserScopedState(queryClient, {
        reason,
        stores: { userScoped: [], devicePreferences: [themeReset, i18nReset] },
      });
    }

    expect(themeReset).not.toHaveBeenCalled();
    expect(i18nReset).not.toHaveBeenCalled();
  });
});
