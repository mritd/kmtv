package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/mritd/kmtv/internal/model"
)

// CreateMediaToken stores a hashed URL-bound media token.
// CreateMediaToken 保存 hash 后且绑定 URL 的媒体 token.
func (s *Store) CreateMediaToken(tokenHash string, authSessionID int64, kind, urlHash, sourceKey string, expiresAt time.Time) (*model.MediaToken, error) {
	now := time.Now()
	result, err := s.db.Exec(
		`INSERT INTO media_tokens (token_hash, auth_session_id, kind, url_hash, source_key, created_at, expires_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		tokenHash,
		authSessionID,
		kind,
		urlHash,
		sourceKey,
		now,
		expiresAt,
	)
	if err != nil {
		return nil, fmt.Errorf("create media token: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("read media token id: %w", err)
	}
	return &model.MediaToken{
		ID:            id,
		TokenHash:     tokenHash,
		AuthSessionID: authSessionID,
		Kind:          kind,
		URLHash:       urlHash,
		SourceKey:     sourceKey,
		CreatedAt:     now,
		ExpiresAt:     expiresAt,
	}, nil
}

// GetValidMediaToken returns a live media token matching token, kind, and URL hash.
// GetValidMediaToken 返回匹配 token, kind 和 URL hash 的有效媒体 token.
func (s *Store) GetValidMediaToken(tokenHash, kind, urlHash string) (*model.MediaToken, error) {
	var token model.MediaToken
	var usedAt sql.NullTime
	err := s.db.QueryRow(
		`SELECT id, token_hash, auth_session_id, kind, url_hash, source_key, created_at, expires_at, used_at
		 FROM media_tokens
		 WHERE token_hash = ? AND kind = ? AND url_hash = ? AND expires_at > ?`,
		tokenHash,
		kind,
		urlHash,
		time.Now(),
	).Scan(&token.ID, &token.TokenHash, &token.AuthSessionID, &token.Kind, &token.URLHash, &token.SourceKey, &token.CreatedAt, &token.ExpiresAt, &usedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get valid media token: %w", err)
	}
	if usedAt.Valid {
		t := usedAt.Time
		token.UsedAt = &t
	}
	return &token, nil
}

// TouchMediaToken marks a media token as used.
// TouchMediaToken 标记媒体 token 已使用.
func (s *Store) TouchMediaToken(id int64) error {
	_, err := s.db.Exec(`UPDATE media_tokens SET used_at = ? WHERE id = ?`, time.Now(), id)
	if err != nil {
		return fmt.Errorf("touch media token: %w", err)
	}
	return nil
}

// DeleteExpiredTokens deletes expired auth and media token rows.
// DeleteExpiredTokens 删除已经过期的 auth 和 media token 记录.
func (s *Store) DeleteExpiredTokens() error {
	if _, err := s.db.Exec(`DELETE FROM media_tokens WHERE expires_at <= ?`, time.Now()); err != nil {
		return fmt.Errorf("delete expired media tokens: %w", err)
	}
	if _, err := s.db.Exec(`DELETE FROM auth_sessions WHERE expires_at <= ?`, time.Now()); err != nil {
		return fmt.Errorf("delete expired auth sessions: %w", err)
	}
	return nil
}
