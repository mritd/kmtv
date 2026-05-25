package service

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/mritd/kmtv/internal/model"
	"github.com/mritd/kmtv/internal/store"
	"github.com/mritd/kmtv/internal/utils"
)

// IssuedAccessToken is returned after successful login.
// IssuedAccessToken 表示登录成功后签发的 access token.
type IssuedAccessToken struct {
	Token     string
	SessionID int64
	ExpiresAt time.Time
}

type cachedAuthSession struct {
	session *model.AuthSession
	user    *model.User
	expires time.Time
}

// AuthService issues, verifies, and revokes opaque bearer tokens.
// AuthService 负责签发, 校验和注销 opaque bearer token.
type AuthService struct {
	store *store.Store
	mu    sync.RWMutex
	cache map[string]cachedAuthSession
}

// NewAuthService creates an AuthService.
// NewAuthService 创建 AuthService.
func NewAuthService(s *store.Store) *AuthService {
	return &AuthService{store: s, cache: make(map[string]cachedAuthSession)}
}

// IssueAccessToken creates and stores a new API access token for a user.
// IssueAccessToken 为用户创建并保存新的 API access token.
func (a *AuthService) IssueAccessToken(user *model.User, ttl time.Duration, userAgent, ip string) (*IssuedAccessToken, error) {
	if user == nil {
		return nil, fmt.Errorf("user is required")
	}
	if ttl <= 0 {
		return nil, fmt.Errorf("access token ttl must be positive")
	}
	token, err := utils.GenerateOpaqueToken()
	if err != nil {
		return nil, err
	}
	expiresAt := time.Now().Add(ttl)
	session, err := a.store.CreateAuthSession(user.ID, utils.HashToken(token), expiresAt, userAgent, ip)
	if err != nil {
		return nil, err
	}
	return &IssuedAccessToken{Token: token, SessionID: session.ID, ExpiresAt: expiresAt}, nil
}

// VerifyAccessToken verifies a bearer token and returns session plus user.
// VerifyAccessToken 校验 bearer token 并返回 session 和用户.
func (a *AuthService) VerifyAccessToken(token string) (*model.AuthSession, *model.User, error) {
	token = strings.TrimSpace(token)
	if err := utils.ValidateOpaqueToken(token); err != nil {
		return nil, nil, nil
	}
	hash := utils.HashToken(token)
	now := time.Now()

	a.mu.RLock()
	cached, ok := a.cache[hash]
	a.mu.RUnlock()
	if ok && now.Before(cached.expires) {
		return cached.session, cached.user, nil
	}

	session, user, err := a.store.GetValidAuthSessionByHash(hash)
	if err != nil || session == nil || user == nil {
		return session, user, err
	}
	_ = a.store.TouchAuthSession(session.ID)
	a.mu.Lock()
	a.cache[hash] = cachedAuthSession{session: session, user: user, expires: session.ExpiresAt}
	a.mu.Unlock()
	return session, user, nil
}

// RevokeAccessToken revokes one bearer token.
// RevokeAccessToken 注销一个 bearer token.
func (a *AuthService) RevokeAccessToken(token string) error {
	if err := utils.ValidateOpaqueToken(token); err != nil {
		return nil
	}
	hash := utils.HashToken(token)
	a.mu.Lock()
	delete(a.cache, hash)
	a.mu.Unlock()
	return a.store.RevokeAuthSessionByHash(hash)
}

// RevokeUserAccessTokens revokes all bearer tokens for one user.
// RevokeUserAccessTokens 注销某个用户的全部 bearer token.
func (a *AuthService) RevokeUserAccessTokens(userID int64) error {
	a.mu.Lock()
	a.cache = make(map[string]cachedAuthSession)
	a.mu.Unlock()
	return a.store.RevokeAuthSessionsByUser(userID)
}

// InvalidateUserCache drops cached bearer lookups for one user without revoking tokens.
// InvalidateUserCache 清理指定用户的 bearer 缓存, 但不注销 token.
func (a *AuthService) InvalidateUserCache(userID int64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for hash, cached := range a.cache {
		if cached.user != nil && cached.user.ID == userID {
			delete(a.cache, hash)
		}
	}
}
