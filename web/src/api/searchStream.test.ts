import { describe, expect, it, vi } from "vitest";

import { parseSearchStreamEvents, searchStream } from "./searchStream";

describe("parseSearchStreamEvents", () => {
  it("parses progress and result events separated by blank lines", () => {
    const events = parseSearchStreamEvents(
      'event: progress\ndata: {"phase":"searching","completed":1,"total":3}\n\n' +
        'event: result\ndata: {"results":[{"title":"Movie","sources":[]}]}\n\n',
    );

    expect(events).toEqual([
      { type: "progress", progress: { phase: "searching", completed: 1, total: 3 } },
      { type: "result", response: { results: [{ title: "Movie", sources: [] }] } },
    ]);
  });

  it("parses stream error events", () => {
    const events = parseSearchStreamEvents('event: error\ndata: {"message":"search failed"}\n\n');

    expect(events).toEqual([{ type: "error", message: "search failed" }]);
  });
});

describe("searchStream", () => {
  it("sends bearer auth and emits stream events", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('event: progress\ndata: {"phase":"searching","completed":1,"total":1}\n\n'),
        );
        controller.enqueue(new TextEncoder().encode('event: result\ndata: {"results":[]}\n\n'));
        controller.close();
      },
    });
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    const events: string[] = [];

    await searchStream({
      query: "Movie",
      accessToken: "token",
      fetcher,
      onEvent: (event) => events.push(event.type),
    });

    expect(fetcher.mock.calls[0][0]).toBe("/api/v1/search/stream?q=Movie&page=1");
    expect(fetcher.mock.calls[0][1]?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer token" }));
    expect(events).toEqual(["progress", "result"]);
  });

  it("emits final event when the stream closes without a trailing blank line", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: result\ndata: {"results":[]}'));
        controller.close();
      },
    });
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    const events: string[] = [];

    await searchStream({ query: "Movie", fetcher, onEvent: (event) => events.push(event.type) });

    expect(events).toEqual(["result"]);
  });

  it("calls onUnauthorized before throwing for unauthorized responses", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 401, statusText: "Unauthorized" }));
    const onUnauthorized = vi.fn();

    await expect(
      searchStream({
        query: "Movie",
        fetcher,
        accessToken: "Expired",
        onUnauthorized,
        onEvent: vi.fn(),
      }),
    ).rejects.toThrow("Unauthorized");
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
