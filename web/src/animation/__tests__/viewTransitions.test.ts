import { describe, expect, it, vi } from "vitest";

import { posterTransitionName, runViewTransition, supportsViewTransitions } from "../viewTransitions";

function makeFakeDoc(supportsAPI: boolean): { doc: Document; spy?: ReturnType<typeof vi.fn> } {
  if (!supportsAPI) {
    return { doc: { } as Document };
  }
  const spy = vi.fn((update: () => void | Promise<void>) => {
    const result = update();
    return { finished: result instanceof Promise ? result.then(() => undefined) : Promise.resolve() };
  });
  const doc = { startViewTransition: spy } as unknown as Document;
  return { doc, spy };
}

describe("supportsViewTransitions", () => {
  it("returns false when startViewTransition is absent", () => {
    const { doc } = makeFakeDoc(false);
    expect(supportsViewTransitions(doc)).toBe(false);
  });

  it("returns true when startViewTransition is a function", () => {
    const { doc } = makeFakeDoc(true);
    expect(supportsViewTransitions(doc)).toBe(true);
  });
});

describe("runViewTransition", () => {
  it("invokes startViewTransition with the update callback when supported", () => {
    const { doc, spy } = makeFakeDoc(true);
    const update = vi.fn();
    runViewTransition(update, doc);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("falls back to direct invocation when unsupported and resolves finished", async () => {
    const { doc } = makeFakeDoc(false);
    const update = vi.fn();
    const transition = runViewTransition(update, doc);
    expect(update).toHaveBeenCalledTimes(1);
    await expect(transition.finished).resolves.toBeUndefined();
  });

  it("propagates an async update through finished in fallback mode", async () => {
    const { doc } = makeFakeDoc(false);
    let resolved = false;
    const transition = runViewTransition(async () => {
      await Promise.resolve();
      resolved = true;
    }, doc);
    await transition.finished;
    expect(resolved).toBe(true);
  });
});

describe("posterTransitionName", () => {
  it("produces a stable name for the same source/video pair", () => {
    expect(posterTransitionName("douban", "movie-123")).toBe("poster-douban-movie-123");
  });

  it("sanitizes characters outside [A-Za-z0-9_-]", () => {
    expect(posterTransitionName("a/b", "x:y z")).toBe("poster-a_b-x_y_z");
  });

  it("yields different names for different sources", () => {
    expect(posterTransitionName("a", "1")).not.toBe(posterTransitionName("b", "1"));
  });
});
