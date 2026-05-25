package errs

// InvalidExternalURLError preserves caller-facing URL validation text while exposing a sentinel.
// InvalidExternalURLError 保留面向调用方的 URL 校验文本, 同时暴露 sentinel error.
type InvalidExternalURLError struct {
	message string
}

// NewInvalidExternalURLError creates an error that matches ErrInvalidExternalURL.
// NewInvalidExternalURLError 创建可匹配 ErrInvalidExternalURL 的错误.
func NewInvalidExternalURLError(message string) error {
	return InvalidExternalURLError{message: message}
}

func (e InvalidExternalURLError) Error() string {
	return e.message
}

func (e InvalidExternalURLError) Unwrap() error {
	return ErrInvalidExternalURL
}
