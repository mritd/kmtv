package errs

import "errors"

// Go sentinel errors are used with errors.Is/errors.As across store, service, and handler boundaries.
// Go sentinel errors 用于在 store, service 和 handler 边界通过 errors.Is/errors.As 判断错误语义.
var (
	// ErrNotFound is returned when a requested record does not exist.
	// ErrNotFound 表示请求的记录不存在.
	ErrNotFound = errors.New("not found")

	// ErrUsernameTaken is returned when a username conflicts with an existing user.
	// ErrUsernameTaken 表示用户名已被已有用户占用.
	ErrUsernameTaken = errors.New("username taken")

	// ErrInvalidUsername is returned when a username violates validation rules.
	// ErrInvalidUsername 表示用户名不符合校验规则.
	ErrInvalidUsername = errors.New("invalid username")

	// ErrInvalidExternalURL is returned when a user-provided external URL is not allowed.
	// ErrInvalidExternalURL 表示用户提供的外部 URL 不被允许.
	ErrInvalidExternalURL = errors.New("invalid external URL")

	// ErrInvalidOpaqueToken is returned when an opaque token has an invalid shape.
	// ErrInvalidOpaqueToken 表示 opaque token 格式不合法.
	ErrInvalidOpaqueToken = errors.New("invalid opaque token")

	// ErrVideoSourceBadStatus is returned when a video source returns a non-OK HTTP status.
	// ErrVideoSourceBadStatus 表示视频源返回了非 OK HTTP 状态码.
	ErrVideoSourceBadStatus = errors.New("video source returned bad status")

	// ErrVideoSourceDecode is returned when a video-source response cannot be decoded.
	// ErrVideoSourceDecode 表示视频源响应无法解析.
	ErrVideoSourceDecode = errors.New("decode video-source response")

	// ErrServiceAlreadyStarted is returned when a one-shot service is started twice.
	// ErrServiceAlreadyStarted 表示一次性服务被重复启动.
	ErrServiceAlreadyStarted = errors.New("service already started")

	// ErrServiceStopped is returned when a one-shot service is started after Stop.
	// ErrServiceStopped 表示一次性服务 Stop 后又被启动.
	ErrServiceStopped = errors.New("service stopped")
)
