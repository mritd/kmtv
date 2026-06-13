// English. 中文.
// Wire-format types shared by every API module. Mirrors apple/Shared/API model files.
// 所有 API 模块共享的 wire 格式类型, 镜像 apple/Shared/API 的模型文件.

/**
 * Authenticated user representation.
 * 已认证用户的表示.
 */
export interface User {
  id: number;
  username: string;
  role: "admin" | "user" | "anonymous";
  avatar?: string;
}

/**
 * Bearer-token response from POST /api/v1/auth/login — flat shape with snake_case wire fields.
 * POST /api/v1/auth/login 返回的 bearer token 响应, 扁平结构, wire 字段使用 snake_case.
 *
 * The server returns a single object that extends the User shape with `access_token` and
 * `expires_at`; clients should NOT expect a nested `user` field.
 * 服务器返回单一对象, 在 User 之上追加 `access_token` 与 `expires_at`; 客户端不要预期 `user` 嵌套字段.
 */
export interface LoginResponse extends User {
  access_token: string;
  expires_at: string;
}

/**
 * Generic message response used by DELETE endpoints + auth/logout.
 * DELETE 接口与 auth/logout 共享的通用 message 响应.
 */
export interface MessageResponse {
  message: string;
}

/**
 * Server settings exposed through GET /api/v1/settings (subset used by M1).
 * GET /api/v1/settings 暴露的服务器设置 (M1 仅使用子集).
 */
export interface SettingsResponse {
  settings: Record<string, string>;
}
