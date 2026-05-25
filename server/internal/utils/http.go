package utils

import "strings"

// ExtractBearerToken extracts a bearer token from an Authorization header value.
// ExtractBearerToken 从 Authorization header 值中提取 bearer token.
func ExtractBearerToken(header string) string {
	header = strings.TrimSpace(header)
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(header, prefix))
}
