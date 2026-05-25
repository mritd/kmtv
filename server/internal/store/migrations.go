package store

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/mritd/kmtv/internal/consts"
)

type migration struct {
	version int
	name    string
	up      func(*sql.Tx) error
}

var migrations = []migration{
	{
		version: 1,
		name:    "create_core_tables",
		up:      migrateCreateCoreTables,
	},
	{
		version: 2,
		name:    "add_user_avatar",
		up:      migrateAddUserAvatar,
	},
	{
		version: 3,
		name:    "add_source_searchable",
		up:      migrateAddSourceSearchable,
	},
	{
		version: 4,
		name:    "insert_default_settings",
		up:      migrateInsertDefaultSettings,
	},
	{
		version: 5,
		name:    "insert_public_base_url_setting",
		up:      migrateInsertPublicBaseURLSetting,
	},
	{
		version: 6,
		name:    "add_opaque_token_auth",
		up:      migrateAddOpaqueTokenAuth,
	},
}

// migrate applies schema changes in version order and records completed steps.
// migrate 按版本顺序执行 schema 变更, 并记录已经完成的步骤.
func (s *Store) migrate() error {
	if err := createMigrationTable(s.db); err != nil {
		return err
	}

	for _, m := range migrations {
		applied, err := migrationApplied(s.db, m.version)
		if err != nil {
			return err
		}
		if applied {
			continue
		}
		if err := s.applyMigration(m); err != nil {
			return err
		}
	}

	return nil
}

func createMigrationTable(db *sql.DB) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	if err != nil {
		return fmt.Errorf("create schema_migrations table: %w", err)
	}
	return nil
}

func migrationApplied(db *sql.DB, version int) (bool, error) {
	var exists int
	err := db.QueryRow(`SELECT 1 FROM schema_migrations WHERE version = ?`, version).Scan(&exists)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return false, fmt.Errorf("check migration %d: %w", version, err)
}

func (s *Store) applyMigration(m migration) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin migration %d %s: %w", m.version, m.name, err)
	}
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()

	if err := m.up(tx); err != nil {
		return fmt.Errorf("apply migration %d %s: %w", m.version, m.name, err)
	}
	if _, err := tx.Exec(
		`INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
		m.version,
		m.name,
	); err != nil {
		return fmt.Errorf("record migration %d %s: %w", m.version, m.name, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migration %d %s: %w", m.version, m.name, err)
	}
	tx = nil
	return nil
}

func migrateCreateCoreTables(tx *sql.Tx) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			password TEXT NOT NULL,
			avatar TEXT DEFAULT '',
			role TEXT NOT NULL DEFAULT 'user',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS sources (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			key TEXT UNIQUE NOT NULL,
			name TEXT NOT NULL,
			api TEXT NOT NULL,
			detail TEXT NOT NULL DEFAULT '',
			enabled BOOLEAN NOT NULL DEFAULT 1,
			comment TEXT NOT NULL DEFAULT '',
			health TEXT NOT NULL DEFAULT 'unknown',
			last_check DATETIME,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS subscriptions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			url TEXT NOT NULL,
			auto_update BOOLEAN NOT NULL DEFAULT 0,
			interval INTEGER NOT NULL DEFAULT 3600,
			last_sync DATETIME,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL DEFAULT '',
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
	}

	for _, stmt := range statements {
		if _, err := tx.Exec(stmt); err != nil {
			return fmt.Errorf("exec statement %.40q: %w", stmt, err)
		}
	}
	return nil
}

func migrateAddUserAvatar(tx *sql.Tx) error {
	hasAvatar, err := tableHasColumn(tx, "users", "avatar")
	if err != nil {
		return err
	}
	if hasAvatar {
		return nil
	}
	if _, err := tx.Exec(`ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ''`); err != nil {
		return fmt.Errorf("add users.avatar column: %w", err)
	}
	return nil
}

func migrateAddSourceSearchable(tx *sql.Tx) error {
	hasSearchable, err := tableHasColumn(tx, "sources", "searchable")
	if err != nil {
		return err
	}
	if hasSearchable {
		return nil
	}
	if _, err := tx.Exec(`ALTER TABLE sources ADD COLUMN searchable BOOLEAN NOT NULL DEFAULT 1`); err != nil {
		return fmt.Errorf("add sources.searchable column: %w", err)
	}
	return nil
}

func migrateInsertDefaultSettings(tx *sql.Tx) error {
	defaults := map[string]string{
		consts.SettingAnonymousAccess:     "true",
		consts.SettingHealthCheckInterval: "3600",
		consts.SettingAdultFilterEnabled:  "true",
		consts.SettingSiteName:            "KMTV",
		consts.SettingDoubanImageProxy:    "tencent",
		consts.SettingPublicBaseURL:       "",
	}
	for key, value := range defaults {
		// INSERT OR IGNORE preserves user-modified settings during migration.
		// INSERT OR IGNORE 在迁移时保留用户已经修改过的设置.
		_, err := tx.Exec(
			`INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
			key,
			value,
		)
		if err != nil {
			return fmt.Errorf("insert default setting %q: %w", key, err)
		}
	}
	return nil
}

func migrateInsertPublicBaseURLSetting(tx *sql.Tx) error {
	// INSERT OR IGNORE makes the migration safe for fresh DBs that already ran default settings.
	// INSERT OR IGNORE 让已经包含默认设置的新库重复执行时保持安全.
	_, err := tx.Exec(
		`INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
		consts.SettingPublicBaseURL,
		"",
	)
	if err != nil {
		return fmt.Errorf("insert public_base_url setting: %w", err)
	}
	return nil
}

func migrateAddOpaqueTokenAuth(tx *sql.Tx) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS auth_sessions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			token_hash TEXT NOT NULL UNIQUE,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			expires_at DATETIME NOT NULL,
			revoked_at DATETIME,
			last_seen_at DATETIME,
			user_agent TEXT NOT NULL DEFAULT '',
			ip TEXT NOT NULL DEFAULT '',
			FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at)`,
		`CREATE TABLE IF NOT EXISTS media_tokens (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			token_hash TEXT NOT NULL UNIQUE,
			auth_session_id INTEGER NOT NULL DEFAULT 0,
			kind TEXT NOT NULL,
			url_hash TEXT NOT NULL,
			source_key TEXT NOT NULL DEFAULT '',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			expires_at DATETIME NOT NULL,
			used_at DATETIME
		)`,
		`CREATE INDEX IF NOT EXISTS idx_media_tokens_expires_at ON media_tokens(expires_at)`,
		`CREATE INDEX IF NOT EXISTS idx_media_tokens_lookup ON media_tokens(token_hash, kind, url_hash)`,
	}
	for _, stmt := range statements {
		if _, err := tx.Exec(stmt); err != nil {
			return fmt.Errorf("exec token auth migration %.40q: %w", stmt, err)
		}
	}

	defaults := map[string]string{
		consts.SettingAccessTokenTTL: fmt.Sprintf("%d", consts.DefaultAccessTokenTTL),
		consts.SettingMediaTokenTTL:  fmt.Sprintf("%d", consts.DefaultMediaTokenTTL),
		consts.SettingPlaybackMode:   consts.PlaybackModeProxy,
	}
	for key, value := range defaults {
		// INSERT OR IGNORE preserves operator-modified settings during migration.
		// INSERT OR IGNORE 在迁移时保留操作者已经修改过的设置.
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
			key,
			value,
		); err != nil {
			return fmt.Errorf("insert token auth setting %q: %w", key, err)
		}
	}
	return nil
}

func tableHasColumn(tx *sql.Tx, tableName, columnName string) (bool, error) {
	rows, err := tx.Query(`PRAGMA table_info(` + tableName + `)`)
	if err != nil {
		return false, fmt.Errorf("read %s columns: %w", tableName, err)
	}
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		var cid int
		var name, typ string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
			return false, fmt.Errorf("scan %s columns: %w", tableName, err)
		}
		if name == columnName {
			return true, nil
		}
	}
	if err := rows.Err(); err != nil {
		return false, fmt.Errorf("iterate %s columns: %w", tableName, err)
	}
	return false, nil
}
