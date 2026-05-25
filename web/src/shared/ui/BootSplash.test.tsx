// BootSplash component tests — brand name resolution (settings / i18n fallback) and ARIA structure.
// BootSplash 组件测试 — 品牌名解析 (设置 / i18n 回退) 和 ARIA 结构.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { APIProvider } from "@/api/context";
import { createTestAPI } from "@/test/testAPI";

import { BootSplash } from "./BootSplash";

// renderBootSplash wraps BootSplash in the required QueryClient + APIProvider context.
// renderBootSplash 将 BootSplash 包裹在所需的 QueryClient + APIProvider 上下文中.
function renderBootSplash(apiOverrides: Parameters<typeof createTestAPI>[0] = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <APIProvider value={createTestAPI(apiOverrides)}>
      <QueryClientProvider client={queryClient}>
        <BootSplash />
      </QueryClientProvider>
    </APIProvider>,
  );
}

describe("BootSplash", () => {
  describe("ARIA structure", () => {
    it("renders a region with role='status' and aria-busy='true'", async () => {
      renderBootSplash();
      // Wait for the query to resolve so the final brand text is in the DOM.
      // 等待查询完成, 确保最终品牌文字已渲染到 DOM.
      await waitFor(() => {
        expect(screen.getByRole("status")).toBeInTheDocument();
      });
      expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    });

    it("has an aria-label on the status element", async () => {
      renderBootSplash();
      await waitFor(() => {
        const status = screen.getByRole("status");
        expect(status.getAttribute("aria-label")).toBeTruthy();
      });
    });
  });

  describe("when settings resolve with a custom site_name", () => {
    it("displays the custom site name from settings", async () => {
      renderBootSplash({
        getSettings: async () => ({ settings: { site_name: "MyStream", version: "v1.0.0" } }),
      });
      await waitFor(() => {
        expect(screen.getByText("MyStream")).toBeInTheDocument();
      });
    });

    it("sets the aria-label to the custom site name", async () => {
      renderBootSplash({
        getSettings: async () => ({ settings: { site_name: "MyStream", version: "v1.0.0" } }),
      });
      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveAttribute("aria-label", "MyStream");
      });
    });

    it("trims whitespace from site_name before displaying", async () => {
      // site_name with surrounding whitespace should be trimmed, matching the .trim() call.
      // 带前后空格的 site_name 应被 trim, 与组件中的 .trim() 调用一致.
      renderBootSplash({
        getSettings: async () => ({ settings: { site_name: "  Padded  ", version: "v1.0.0" } }),
      });
      await waitFor(() => {
        expect(screen.getByText("Padded")).toBeInTheDocument();
      });
    });
  });

  describe("when settings have no site_name", () => {
    it("falls back to the i18n brand string when site_name is absent", async () => {
      // getSettings returns settings without site_name; component should use t("brand").
      // settings 中无 site_name 时, 组件应使用 t("brand") 翻译值.
      renderBootSplash({
        getSettings: async () => ({ settings: { version: "v1.0.0" } }),
      });
      // The i18n brand key will resolve to some non-empty text.
      // i18n brand 键会解析为非空文本.
      await waitFor(() => {
        const status = screen.getByRole("status");
        expect(status.getAttribute("aria-label")).toBeTruthy();
        expect(status.getAttribute("aria-label")).not.toBe("");
      });
    });

    it("falls back to the i18n brand string when site_name is empty string", async () => {
      // An empty site_name after trim should fall through to the t("brand") fallback.
      // trim 后为空的 site_name 应回退到 t("brand").
      renderBootSplash({
        getSettings: async () => ({ settings: { site_name: "", version: "v1.0.0" } }),
      });
      await waitFor(() => {
        const status = screen.getByRole("status");
        expect(status.getAttribute("aria-label")).toBeTruthy();
      });
    });
  });

  describe("when the settings query rejects", () => {
    it("falls back to the i18n brand string on query error", async () => {
      // If getSettings throws, the component must still render using t("brand") as fallback.
      // getSettings 抛出异常时, 组件必须使用 t("brand") 降级渲染, 不能崩溃.
      renderBootSplash({
        getSettings: async () => {
          throw new Error("network error");
        },
      });
      // After the query settles (rejected), the brand text from t("brand") should be visible.
      // 查询失败 (rejected) 后, t("brand") 的品牌文字应可见.
      await waitFor(() => {
        const status = screen.getByRole("status");
        expect(status.getAttribute("aria-label")).toBeTruthy();
        // The label must not be empty or the literal error message.
        // aria-label 不得为空或错误信息字面量.
        expect(status.getAttribute("aria-label")).not.toContain("network error");
      });
    });
  });

  describe("spinner", () => {
    it("renders the spinner element with aria-hidden", async () => {
      renderBootSplash();
      await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
      const spinner = document.querySelector(".boot-splash-spinner");
      expect(spinner).not.toBeNull();
      // The spinner is decorative; aria-hidden prevents AT from announcing it.
      // 旋转器为装饰性; aria-hidden 防止辅助技术播报.
      expect(spinner?.getAttribute("aria-hidden")).toBe("true");
    });
  });
});
