import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createTestAPI } from "@/test/testAPI";
import { APIProvider, useAPI } from "./context";

function Consumer() {
  useAPI();
  return null;
}

function DisplayUsername() {
  const api = useAPI();
  const [username, setUsername] = React.useState<string | null>(null);
  React.useEffect(() => {
    void api.me().then((u) => setUsername(u.username));
  }, [api]);
  return <span>{username}</span>;
}

describe("useAPI", () => {
  it("throws when the provider is missing", () => {
    expect(() => render(<Consumer />)).toThrow("APIProvider is missing");
  });

  it("returns the client when provider is mounted", async () => {
    // Use a distinct username so the assertion targets real hook behavior, not a default stub value.
    // 使用独特用户名, 确保断言验证的是真实 hook 行为, 而非默认存根的值.
    const api = createTestAPI({
      me: async () => ({ id: 42, username: "unique-test-user", role: "user" }),
    });
    render(
      <APIProvider value={api}>
        <DisplayUsername />
      </APIProvider>,
    );
    expect(await screen.findByText("unique-test-user")).toBeTruthy();
  });
});
