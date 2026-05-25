package utils

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"github.com/mritd/kmtv/internal/base58"
	"github.com/mritd/kmtv/internal/errs"
)

const opaqueTokenBytes = 32

// GenerateOpaqueToken creates a random base58 token suitable for headers and URLs.
// GenerateOpaqueToken 生成适合 header 和 URL 使用的随机 base58 token.
func GenerateOpaqueToken() (string, error) {
	raw := make([]byte, opaqueTokenBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate opaque token: %w", err)
	}
	return base58.Encode(raw), nil
}

// HashToken returns a stable SHA-256 hex hash for token storage.
// HashToken 返回用于持久化存储的稳定 SHA-256 hex hash.
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// ValidateOpaqueToken checks basic base58 token shape before hashing or lookup.
// ValidateOpaqueToken 在 hash 或查询前检查 base58 token 基本格式.
func ValidateOpaqueToken(token string) error {
	decoded := base58.Decode(token)
	if len(decoded) != opaqueTokenBytes {
		return errs.ErrInvalidOpaqueToken
	}
	return nil
}
