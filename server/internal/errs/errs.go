// Package errs provides structured API error responses with machine-readable codes.
// Package errs 提供带机器可读 code 的结构化 API 错误响应.
package errs

import "fmt"

// E is a structured API error response.
// Usage: c.JSON(http.StatusBadRequest, errs.InvalidRequest)
// E 表示结构化 API 错误响应.
// 用法: c.JSON(http.StatusBadRequest, errs.InvalidRequest)
type E struct {
	Code    int    `json:"code"`
	Message string `json:"error"`
}

func (e E) Error() string {
	return fmt.Sprintf("[%d] %s", e.Code, e.Message)
}

// WithMsg returns a copy with a custom message, keeping the same code.
// WithMsg 返回带自定义 message 的副本, code 保持不变.
func (e E) WithMsg(msg string) E {
	return E{Code: e.Code, Message: msg}
}

// --- Auth (10xx) ---
// --- 认证错误 (10xx) ---

var (
	InvalidRequest     = E{1000, "invalid request body"}
	InvalidCredentials = E{1001, "invalid username or password"}
	NotLoggedIn        = E{1002, "not logged in"}
	UserNotFound       = E{1003, "user not found"}
	UsernameTaken      = E{1004, "username already taken"}
	IncorrectPassword  = E{1005, "incorrect old password"}
)

// --- Avatar (11xx) ---
// --- 头像错误 (11xx) ---

var (
	MissingAvatar        = E{1100, "missing avatar file"}
	FileTooLarge         = E{1101, "file too large, max 256KB"}
	UnsupportedImageType = E{1102, "unsupported image type"}
	NoAvatar             = E{1103, "no avatar"}
	InvalidData          = E{1104, "invalid avatar data"}
)

// --- Resource (12xx) ---
// --- 资源错误 (12xx) ---

var (
	InvalidID      = E{1200, "invalid id"}
	MissingFields  = E{1201, "required fields missing"}
	InvalidURL     = E{1202, "invalid URL"}
	InvalidRole    = E{1203, "role must be 'admin' or 'user'"}
	NotFound       = E{1204, "resource not found"}
	UnknownSetting = E{1205, "unknown setting"}
	LastAdmin      = E{1206, "cannot remove the last admin"}
	SelfDelete     = E{1207, "cannot delete your own account"}
)

// --- General (13xx) ---
// --- 通用错误 (13xx) ---

var (
	ServerError  = E{1300, "internal server error"}
	MissingParam = E{1301, "missing required parameter"}
	Blocked      = E{1302, "request blocked"}
	GatewayError = E{1303, "external service unavailable"}
)
