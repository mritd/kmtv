package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/mritd/kmtv/internal/model"
)

// CreateAuthSession stores a hashed API access token session.
// CreateAuthSession 保存 hash 后的 API access token 会话.
func (s *Store) CreateAuthSession(userID int64, tokenHash string, expiresAt time.Time, userAgent, ip string) (*model.AuthSession, error) {
	now := time.Now()
	result, err := s.db.Exec(
		`INSERT INTO auth_sessions (user_id, token_hash, created_at, expires_at, user_agent, ip)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		userID,
		tokenHash,
		now,
		expiresAt,
		userAgent,
		ip,
	)
	if err != nil {
		return nil, fmt.Errorf("create auth session: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("read auth session id: %w", err)
	}
	return &model.AuthSession{
		ID:        id,
		UserID:    userID,
		TokenHash: tokenHash,
		CreatedAt: now,
		ExpiresAt: expiresAt,
		UserAgent: userAgent,
		IP:        ip,
	}, nil
}

// GetValidAuthSessionByHash returns a live auth session and its user.
// GetValidAuthSessionByHash 返回有效 auth session 及其用户.
func (s *Store) GetValidAuthSessionByHash(tokenHash string) (*model.AuthSession, *model.User, error) {
	var session model.AuthSession
	var user model.User
	var revokedAt sql.NullTime
	var lastSeenAt sql.NullTime
	err := s.db.QueryRow(
		`SELECT
			a.id, a.user_id, a.token_hash, a.created_at, a.expires_at, a.revoked_at, a.last_seen_at, a.user_agent, a.ip,
			u.id, u.username, u.password, u.avatar, u.role, u.created_at, u.updated_at
		 FROM auth_sessions a
		 JOIN users u ON u.id = a.user_id
		 WHERE a.token_hash = ? AND a.revoked_at IS NULL AND a.expires_at > ?`,
		tokenHash,
		time.Now(),
	).Scan(
		&session.ID, &session.UserID, &session.TokenHash, &session.CreatedAt, &session.ExpiresAt, &revokedAt, &lastSeenAt, &session.UserAgent, &session.IP,
		&user.ID, &user.Username, &user.Password, &user.Avatar, &user.Role, &user.CreatedAt, &user.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, fmt.Errorf("get valid auth session: %w", err)
	}
	if revokedAt.Valid {
		t := revokedAt.Time
		session.RevokedAt = &t
	}
	if lastSeenAt.Valid {
		t := lastSeenAt.Time
		session.LastSeenAt = &t
	}
	return &session, &user, nil
}

// RevokeAuthSessionByHash revokes one API access token.
// RevokeAuthSessionByHash 注销一个 API access token.
func (s *Store) RevokeAuthSessionByHash(tokenHash string) error {
	_, err := s.db.Exec(
		`UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`,
		time.Now(),
		tokenHash,
	)
	if err != nil {
		return fmt.Errorf("revoke auth session: %w", err)
	}
	return nil
}

// RevokeAuthSessionsByUser revokes all API access tokens for a user.
// RevokeAuthSessionsByUser 注销某个用户的全部 API access token.
func (s *Store) RevokeAuthSessionsByUser(userID int64) error {
	_, err := s.db.Exec(
		`UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
		time.Now(),
		userID,
	)
	if err != nil {
		return fmt.Errorf("revoke auth sessions by user: %w", err)
	}
	return nil
}

// TouchAuthSession updates the last seen timestamp for a session.
// TouchAuthSession 更新 session 最近访问时间.
func (s *Store) TouchAuthSession(id int64) error {
	_, err := s.db.Exec(`UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?`, time.Now(), id)
	if err != nil {
		return fmt.Errorf("touch auth session: %w", err)
	}
	return nil
}
