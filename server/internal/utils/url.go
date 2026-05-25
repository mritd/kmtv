package utils

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/mritd/kmtv/internal/errs"
)

// ValidateExternalURL checks that a user-provided external URL uses http/https and has a host.
// This is a quick shape check; caller-specific network protections still belong to the caller.
// ValidateExternalURL 检查用户提供的外部 URL 是否使用 http/https 且包含 host.
// 这里只做快速格式检查; 调用方专属的网络安全防护仍由调用方负责.
func ValidateExternalURL(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return errs.NewInvalidExternalURLError(fmt.Sprintf("invalid URL: %v", err))
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return errs.NewInvalidExternalURLError("only http/https URLs are allowed")
	}
	if u.Hostname() == "" {
		return errs.NewInvalidExternalURLError("URL host is required")
	}
	return nil
}

// ResolveURL resolves a potentially relative URL against a base URL.
// ResolveURL 基于 base URL 解析可能为相对路径的 URL.
func ResolveURL(base, ref string) string {
	if strings.HasPrefix(ref, "http://") || strings.HasPrefix(ref, "https://") {
		return ref
	}

	baseURL, err := url.Parse(base)
	if err != nil {
		return ref
	}
	refURL, err := url.Parse(ref)
	if err != nil {
		return ref
	}

	return baseURL.ResolveReference(refURL).String()
}

// ExtractBaseURL returns the directory portion of a URL.
// ExtractBaseURL 返回 URL 的目录部分.
func ExtractBaseURL(rawURL string) string {
	idx := strings.LastIndex(rawURL, "/")
	if idx < 0 {
		return rawURL
	}
	return rawURL[:idx+1]
}
