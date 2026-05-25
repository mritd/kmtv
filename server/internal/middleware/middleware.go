package middleware

import (
	"net"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/mritd/kmtv/internal/consts"
	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
	"github.com/mritd/kmtv/internal/store"
	"github.com/mritd/kmtv/internal/utils"
)

type authVerifier interface {
	VerifyAccessToken(token string) (*model.AuthSession, *model.User, error)
}

// anonAccessCache caches the anonymous_access setting to avoid querying the
// database on every request. The value is refreshed every 30 seconds.
// anonAccessCache 缓存 anonymous_access 设置, 避免每个请求都查询数据库.
// 缓存值每 30 秒刷新一次.
var anonAccessCache struct {
	sync.Mutex
	value   string
	expires time.Time
}

// ResetAnonAccessCache clears the cached anonymous_access value.
// Intended for use in tests and when settings are updated.
// ResetAnonAccessCache 清除 anonymous_access 缓存值.
// 用于测试以及设置被更新时.
func ResetAnonAccessCache() {
	anonAccessCache.Lock()
	defer anonAccessCache.Unlock()
	anonAccessCache.value = ""
	anonAccessCache.expires = time.Time{}
}

// trySetUser attempts to resolve a bearer token and set user context.
// trySetUser 尝试解析 bearer token, 并设置用户上下文.
func trySetUser(c *gin.Context, verifier authVerifier) bool {
	token := utils.ExtractBearerToken(c.GetHeader("Authorization"))
	if token == "" || verifier == nil {
		return false
	}
	session, user, err := verifier.VerifyAccessToken(token)
	if err != nil || session == nil || user == nil {
		return false
	}
	c.Set("auth_session", session)
	c.Set("user", user)
	c.Set("username", user.Username)
	c.Set("role", user.Role)
	return true
}

// OptionalAuth tries to resolve bearer authentication and set user context.
// Always allows the request through regardless of authentication result.
// OptionalAuth 尝试解析 bearer 认证并设置用户上下文.
// 无论认证结果如何都会放行请求.
func OptionalAuth(verifier authVerifier) gin.HandlerFunc {
	return func(c *gin.Context) {
		trySetUser(c, verifier)
		c.Next()
	}
}

// Auth checks authentication. If anonymous_access setting is "true", allows all
// requests through. Otherwise checks the bearer token and sets user context.
// Auth 检查认证状态. 如果 anonymous_access 为 "true", 则允许所有请求通过.
// 否则会校验 bearer token 并设置用户上下文.
func Auth(s *store.Store, verifier authVerifier) gin.HandlerFunc {
	return func(c *gin.Context) {
		if trySetUser(c, verifier) {
			c.Next()
			return
		}
		if utils.ExtractBearerToken(c.GetHeader("Authorization")) != "" {
			c.JSON(http.StatusUnauthorized, errs.NotLoggedIn.WithMsg("invalid or expired token"))
			c.Abort()
			return
		}

		// No bearer token at all; allow through as anonymous if enabled.
		// 完全没有 bearer token 时, 如果启用了匿名访问则放行.
		anonAccess, err := getCachedAnonAccess(s)
		if err != nil {
			c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to read settings"))
			c.Abort()
			return
		}
		if anonAccess == "true" {
			c.Set("username", "anonymous")
			c.Set("role", "user")
			c.Next()
			return
		}

		c.JSON(http.StatusUnauthorized, errs.NotLoggedIn)
		c.Abort()
	}
}

// getCachedAnonAccess returns the anonymous_access setting, using a short-lived
// cache to avoid querying the database on every request.
// getCachedAnonAccess 返回 anonymous_access 设置, 使用短生命周期缓存避免每个请求都查询数据库.
func getCachedAnonAccess(s *store.Store) (string, error) {
	anonAccessCache.Lock()
	defer anonAccessCache.Unlock()

	if time.Now().Before(anonAccessCache.expires) {
		return anonAccessCache.value, nil
	}

	val, err := s.GetSetting(consts.SettingAnonymousAccess)
	if err != nil {
		return "", err
	}
	anonAccessCache.value = val
	anonAccessCache.expires = time.Now().Add(consts.AnonAccessCacheTTL)
	return val, nil
}

// AdminOnly requires role == "admin" from the gin context.
// AdminOnly 要求 gin context 中的 role 为 "admin".
func AdminOnly() gin.HandlerFunc {
	return func(c *gin.Context) {
		role, exists := c.Get("role")
		if !exists || role != "admin" {
			c.JSON(http.StatusForbidden, errs.Blocked.WithMsg("admin access required"))
			c.Abort()
			return
		}
		c.Next()
	}
}

// CORS adds CORS headers. Only allows same-host origins and localhost.
// CORS 添加 CORS header. 只允许同 host origin 和 localhost.
func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" && isAllowedOrigin(origin, c.Request.Host) {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Credentials", "true")
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		c.Header("Access-Control-Max-Age", "86400")

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

// MaxBodySize limits the request body size.
// MaxBodySize 限制请求体大小.
func MaxBodySize(maxBytes int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Body != nil {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)
		}
		c.Next()
	}
}

// isAllowedOrigin checks if the origin host matches the request host or is localhost.
// isAllowedOrigin 检查 origin host 是否匹配请求 host 或是否为 localhost.
func isAllowedOrigin(origin, requestHost string) bool {
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	originHost := u.Hostname()
	reqHost := requestHost
	// Strip port from request host if present.
	// 如果请求 host 包含端口, 则移除端口.
	if h, _, err := net.SplitHostPort(requestHost); err == nil {
		reqHost = h
	}
	if originHost == reqHost {
		return true
	}
	if originHost == "localhost" || originHost == "127.0.0.1" || originHost == "::1" {
		return true
	}
	return false
}
