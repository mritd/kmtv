// English. 中文.
// APIError discriminated union — every network failure surfaces as one of these kinds.
// APIError 判别式联合类型, 所有网络失败都会映射为其中一种.

/**
 * Discriminated union representing every API failure surface.
 * 表示所有 API 失败类型的判别式联合.
 */
export type APIError =
  | { kind: "unauthorized" }
  | { kind: "invalidURL" }
  | { kind: "network" }
  | { kind: "timeout" }
  | { kind: "server"; message: string };

/**
 * Helper namespace for construction and message extraction.
 * 用于构造与提取消息的 helper 命名空间.
 */
export const APIError = {
  /**
   * Convert a fetch Response into an APIError. Caller pre-checks res.ok.
   * 将 fetch 响应转换为 APIError, 调用方已经判定 res.ok 为 false.
   */
  async fromResponse(res: Response): Promise<APIError> {
    if (res.status === 401) return { kind: "unauthorized" };
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      if (body.error) message = body.error;
      else if (body.message) message = body.message;
    } catch {
      // Body was not JSON; keep the status fallback.
      // body 非 JSON, 保留状态码兜底.
    }
    return { kind: "server", message };
  },
} as const;

/**
 * Localised, single-line message used by toast surfaces.
 * 用于 toast 等界面的单行本地化消息.
 */
export function localizedMessage(err: APIError): string {
  switch (err.kind) {
    case "unauthorized":
      return "Authentication required";
    case "invalidURL":
      return "Invalid server URL";
    case "network":
      return "Network error";
    case "timeout":
      return "Request timed out";
    case "server":
      return err.message;
  }
}
