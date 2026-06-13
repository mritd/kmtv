// viewerHooks tests confirm useDoubanHomeQuery wires queryKey + queryFn correctly.
// viewerHooks 测试确认 useDoubanHomeQuery 正确绑定 queryKey 与 queryFn.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import React from "react";

import type { DoubanAPI } from "./douban";
import { useDoubanHomeQuery } from "./viewerHooks";

function wrapper(client: QueryClient) {
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useDoubanHomeQuery", () => {
  it("returns data from the injected DoubanAPI", async () => {
    const payload = { sections: [{ name: "s1", tag: "t", type: "movie", items: [] }] };
    const api: DoubanAPI = { doubanHome: jest.fn(async () => payload) };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDoubanHomeQuery(api), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.sections[0]!.name).toBe("s1");
    expect(api.doubanHome).toHaveBeenCalledTimes(1);
  });
});
