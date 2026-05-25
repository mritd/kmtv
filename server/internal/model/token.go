package model

import "time"

// AuthSession represents one API bearer token session.
// AuthSession 表示一个 API bearer token 会话.
type AuthSession struct {
	ID         int64
	UserID     int64
	TokenHash  string
	CreatedAt  time.Time
	ExpiresAt  time.Time
	RevokedAt  *time.Time
	LastSeenAt *time.Time
	UserAgent  string
	IP         string
}

// MediaToken represents one URL-bound media proxy token.
// MediaToken 表示一个绑定 URL 的媒体代理 token.
type MediaToken struct {
	ID            int64
	TokenHash     string
	AuthSessionID int64
	Kind          string
	URLHash       string
	SourceKey     string
	CreatedAt     time.Time
	ExpiresAt     time.Time
	UsedAt        *time.Time
}
