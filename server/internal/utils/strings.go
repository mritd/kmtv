package utils

import (
	"regexp"
	"strings"
)

var htmlTagRe = regexp.MustCompile(`<[^>]*>`)

// StripHTML removes HTML tags and trims whitespace.
// StripHTML 移除 HTML tag 并裁剪空白字符.
func StripHTML(s string) string {
	return strings.TrimSpace(htmlTagRe.ReplaceAllString(s, ""))
}

// Truncate returns the first maxLen runes of s, appending "..." if truncated.
// Uses rune-aware slicing to avoid splitting multi-byte UTF-8 characters.
// Truncate 返回 s 的前 maxLen 个 rune, 如果发生截断则追加 "...".
// 使用 rune 感知切片, 避免拆分多字节 UTF-8 字符.
func Truncate(s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}
	return string(runes[:maxLen]) + "..."
}
