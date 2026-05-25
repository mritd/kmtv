package service

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/mritd/kmtv/internal/model"
	"github.com/mritd/kmtv/internal/store"
	"github.com/mritd/kmtv/internal/utils"
)

const (
	// MediaKindM3U8 identifies a proxied playlist URL.
	// MediaKindM3U8 标识被代理的播放列表 URL.
	MediaKindM3U8 = "m3u8"

	// MediaKindSegment identifies a proxied media segment URL.
	// MediaKindSegment 标识被代理的媒体分片 URL.
	MediaKindSegment = "segment"

	// MediaKindKey identifies a proxied media key URL.
	// MediaKindKey 标识被代理的媒体密钥 URL.
	MediaKindKey = "key"
)

// MediaTokenService issues and verifies URL-bound opaque media tokens.
// MediaTokenService 负责签发和校验绑定 URL 的 opaque media token.
type MediaTokenService struct {
	store *store.Store
}

// NewMediaTokenService creates a MediaTokenService.
// NewMediaTokenService 创建 MediaTokenService.
func NewMediaTokenService(s *store.Store) *MediaTokenService {
	return &MediaTokenService{store: s}
}

// HashMediaURL returns the stable hash used to bind tokens to exact URLs.
// HashMediaURL 返回用于将 token 绑定到精确 URL 的稳定 hash.
func HashMediaURL(rawURL string) string {
	sum := sha256.Sum256([]byte(rawURL))
	return hex.EncodeToString(sum[:])
}

// IssueMediaToken creates a short-lived opaque token for one media URL and kind.
// IssueMediaToken 为单个媒体 URL 和 kind 创建短期 opaque token.
func (m *MediaTokenService) IssueMediaToken(authSessionID int64, kind, rawURL, sourceKey string, ttl time.Duration) (string, error) {
	if ttl <= 0 {
		return "", fmt.Errorf("media token ttl must be positive")
	}
	if err := utils.ValidateExternalURL(rawURL); err != nil {
		return "", err
	}
	token, err := utils.GenerateOpaqueToken()
	if err != nil {
		return "", err
	}
	_, err = m.store.CreateMediaToken(utils.HashToken(token), authSessionID, kind, HashMediaURL(rawURL), sourceKey, time.Now().Add(ttl))
	if err != nil {
		return "", err
	}
	return token, nil
}

// VerifyMediaToken checks that token is valid for this exact kind and URL.
// VerifyMediaToken 校验 token 对当前 kind 和精确 URL 是否有效.
func (m *MediaTokenService) VerifyMediaToken(token, kind, rawURL string) (bool, error) {
	_, ok, err := m.VerifyMediaTokenDetail(token, kind, rawURL)
	return ok, err
}

// VerifyMediaTokenDetail checks that token is valid and returns its stored metadata.
// VerifyMediaTokenDetail 校验 token 是否有效, 并返回其存储的元数据.
func (m *MediaTokenService) VerifyMediaTokenDetail(token, kind, rawURL string) (*model.MediaToken, bool, error) {
	if err := utils.ValidateOpaqueToken(token); err != nil {
		return nil, false, nil
	}
	got, err := m.store.GetValidMediaToken(utils.HashToken(token), kind, HashMediaURL(rawURL))
	if err != nil || got == nil {
		return nil, false, err
	}
	_ = m.store.TouchMediaToken(got.ID)
	return got, true, nil
}
