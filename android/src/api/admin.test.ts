// AdminAPI tests — verify each method calls the right path with the expected payload.
// AdminAPI 测试 — 验证每个方法调用正确的路径与负载.

import { createAdminAPI } from "./admin";
import type { APIClient } from "./client";

function makeClient(overrides: Partial<APIClient> = {}): APIClient {
  const noop = async () => undefined as never;
  return {
    baseURL: "http://localhost",
    get: jest.fn(noop),
    post: jest.fn(noop),
    put: jest.fn(noop),
    del: jest.fn(noop),
    getBlob: jest.fn(noop),
    putMultipart: jest.fn(noop),
    delReturning: jest.fn(noop),
    ...overrides,
  };
}

describe("createAdminAPI", () => {
  test("listSources unwraps {sources} from /admin/sources", async () => {
    const client = makeClient({ get: jest.fn().mockResolvedValue({ sources: [{ id: 1, name: "X" }] }) });
    const out = await createAdminAPI(client).listSources();
    expect(client.get).toHaveBeenCalledWith("/admin/sources");
    expect(out).toEqual([{ id: 1, name: "X" }]);
  });

  test("updateSource PUTs full payload to /admin/sources/{id}", async () => {
    const client = makeClient();
    const payload = { name: "n", api: "a", detail: "d", comment: "", enabled: true, is_adult: false };
    await createAdminAPI(client).updateSource(42, payload);
    expect(client.put).toHaveBeenCalledWith("/admin/sources/42", payload);
  });

  test("deleteSource hits /admin/sources/{id}", async () => {
    const client = makeClient();
    await createAdminAPI(client).deleteSource(7);
    expect(client.del).toHaveBeenCalledWith("/admin/sources/7");
  });

  test("checkSource POSTs to /admin/sources/{id}/check and returns health", async () => {
    const client = makeClient({ post: jest.fn().mockResolvedValue({ health: "healthy" }) });
    const res = await createAdminAPI(client).checkSource(11);
    expect(client.post).toHaveBeenCalledWith("/admin/sources/11/check");
    expect(res.health).toBe("healthy");
  });

  test("checkAllSources POST no body to /admin/sources/check-all", async () => {
    const client = makeClient();
    await createAdminAPI(client).checkAllSources();
    expect(client.post).toHaveBeenCalledWith("/admin/sources/check-all");
  });

  test("bulkSetSourcesEnabled POSTs ids+enabled to /admin/sources/bulk-enabled", async () => {
    const client = makeClient();
    await createAdminAPI(client).bulkSetSourcesEnabled({ ids: [1, 2], enabled: false });
    expect(client.post).toHaveBeenCalledWith("/admin/sources/bulk-enabled", { ids: [1, 2], enabled: false });
  });

  test("importSources parses string body before sending", async () => {
    const client = makeClient({ post: jest.fn().mockResolvedValue({ imported: 3 }) });
    const res = await createAdminAPI(client).importSources('{"sites":{}}');
    expect(client.post).toHaveBeenCalledWith("/admin/sources/import", { sites: {} });
    expect(res.imported).toBe(3);
  });

  test("listSubscriptions unwraps {subscriptions} from /admin/subscriptions", async () => {
    const client = makeClient({ get: jest.fn().mockResolvedValue({ subscriptions: [{ id: 1 }] }) });
    expect(await createAdminAPI(client).listSubscriptions()).toEqual([{ id: 1 }]);
  });

  test("createSubscription POSTs and returns server payload", async () => {
    const client = makeClient({
      post: jest.fn().mockResolvedValue({ id: 9, url: "http://x", auto_update: true, interval: 60, last_sync: "", updated_at: "" }),
    });
    const out = await createAdminAPI(client).createSubscription({ url: "http://x", auto_update: true, interval: 60 });
    expect(client.post).toHaveBeenCalledWith("/admin/subscriptions", { url: "http://x", auto_update: true, interval: 60 });
    expect(out.id).toBe(9);
  });

  test("syncSubscription POSTs to /admin/subscriptions/{id}/sync", async () => {
    const client = makeClient();
    await createAdminAPI(client).syncSubscription(5);
    expect(client.post).toHaveBeenCalledWith("/admin/subscriptions/5/sync");
  });

  test("deleteSubscription DELETEs by id at /admin/subscriptions/{id}", async () => {
    const client = makeClient();
    await createAdminAPI(client).deleteSubscription(13);
    expect(client.del).toHaveBeenCalledWith("/admin/subscriptions/13");
  });

  test("listUsers unwraps {users} from /admin/users", async () => {
    const client = makeClient({
      get: jest.fn().mockResolvedValue({ users: [{ id: 1, username: "u", role: "user", allow_adult_content: false }] }),
    });
    expect((await createAdminAPI(client).listUsers())[0]!.username).toBe("u");
  });

  test("createUser POSTs payload to /admin/users", async () => {
    const client = makeClient({
      post: jest.fn().mockResolvedValue({ id: 2, username: "n", role: "user", allow_adult_content: false }),
    });
    const payload = { username: "n", password: "p", role: "user" as const, allow_adult_content: false };
    await createAdminAPI(client).createUser(payload);
    expect(client.post).toHaveBeenCalledWith("/admin/users", payload);
  });

  test("deleteUser DELETEs by id at /admin/users/{id}", async () => {
    const client = makeClient();
    await createAdminAPI(client).deleteUser(8);
    expect(client.del).toHaveBeenCalledWith("/admin/users/8");
  });

  test("getSettings unwraps {settings} from /settings (no admin prefix on GET)", async () => {
    const client = makeClient({ get: jest.fn().mockResolvedValue({ settings: { site_name: "X" } }) });
    expect(await createAdminAPI(client).getSettings()).toEqual({ site_name: "X" });
    expect(client.get).toHaveBeenCalledWith("/settings");
  });

  test("updateSettings PUTs flat map (no wrapper) to /admin/settings", async () => {
    const client = makeClient();
    await createAdminAPI(client).updateSettings({ site_name: "Y" });
    expect(client.put).toHaveBeenCalledWith("/admin/settings", { site_name: "Y" });
  });
});
