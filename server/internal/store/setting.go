package store

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/mritd/kmtv/internal/model"
)

// GetSetting retrieves the value of a setting by key.
// Returns empty string and no error if the key does not exist.
// GetSetting 根据 key 获取设置值.
// 如果 key 不存在, 返回空字符串且不返回错误.
func (s *Store) GetSetting(key string) (string, error) {
	var value string
	err := s.db.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("get setting %q: %w", key, err)
	}
	return value, nil
}

// SetSetting inserts or updates a setting key-value pair.
// SetSetting 插入或更新设置 key-value.
func (s *Store) SetSetting(key, value string) error {
	_, err := s.db.Exec(
		`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
		key, value,
	)
	if err != nil {
		return fmt.Errorf("set setting %q: %w", key, err)
	}
	return nil
}

// GetAllSettings retrieves all settings.
// GetAllSettings 获取所有设置.
func (s *Store) GetAllSettings() ([]model.Setting, error) {
	rows, err := s.db.Query("SELECT key, value, updated_at FROM settings ORDER BY key")
	if err != nil {
		return nil, fmt.Errorf("query all settings: %w", err)
	}
	defer func() { _ = rows.Close() }()

	// Non-nil slice so an empty result marshals to JSON [] rather than null.
	// 使用非 nil 切片, 让空结果序列化为 JSON [] 而非 null.
	settings := []model.Setting{}
	for rows.Next() {
		var st model.Setting
		if err := rows.Scan(&st.Key, &st.Value, &st.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan setting: %w", err)
		}
		settings = append(settings, st)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate settings: %w", err)
	}
	return settings, nil
}
