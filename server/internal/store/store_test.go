package store

import (
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"github.com/mritd/kmtv/internal/consts"
	_ "modernc.org/sqlite"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := New(":memory:")
	if err != nil {
		t.Fatalf("failed to create test store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestNewStore(t *testing.T) {
	s := newTestStore(t)

	// Verify all expected tables exist.
	tables := []string{
		"users",
		"sources",
		"subscriptions",
		"settings",
		"schema_migrations",
		"auth_sessions",
		"media_tokens",
	}
	for _, table := range tables {
		var name string
		err := s.db.QueryRow(
			"SELECT name FROM sqlite_master WHERE type='table' AND name=?", table,
		).Scan(&name)
		if err != nil {
			t.Errorf("table %q not found: %v", table, err)
		}
	}
}

func TestMigrateRecordsAppliedVersions(t *testing.T) {
	s := newTestStore(t)

	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&count); err != nil {
		t.Fatalf("count schema migrations: %v", err)
	}
	if count == 0 {
		t.Fatal("expected schema_migrations to contain applied versions")
	}

	if err := s.migrate(); err != nil {
		t.Fatalf("second migrate error: %v", err)
	}
	var countAfter int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&countAfter); err != nil {
		t.Fatalf("count schema migrations after second run: %v", err)
	}
	if countAfter != count {
		t.Fatalf("migration count after second run = %d, want %d", countAfter, count)
	}
}

func TestMigrateAddsPublicBaseURLSettingToExistingV4DB(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings-v4.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open v4 db: %v", err)
	}
	statements := []string{
		`CREATE TABLE settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL DEFAULT '',
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE schema_migrations (
			version INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`INSERT INTO schema_migrations (version, name) VALUES
			(1, 'create_core_tables'),
			(2, 'add_user_avatar'),
			(3, 'add_source_searchable'),
			(4, 'insert_default_settings')`,
	}
	for _, stmt := range statements {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("prepare v4 db: %v", err)
		}
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close v4 db: %v", err)
	}

	s, err := New(dbPath)
	if err != nil {
		t.Fatalf("open migrated v4 store: %v", err)
	}
	defer func() { _ = s.Close() }()

	value, err := s.GetSetting(consts.SettingPublicBaseURL)
	if err != nil {
		t.Fatalf("GetSetting public_base_url: %v", err)
	}
	if value != "" {
		t.Fatalf("public_base_url = %q, want empty default", value)
	}
}

func TestMigrateUpgradesLegacySchema(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "legacy.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open legacy db: %v", err)
	}
	legacySchema := []string{
		`CREATE TABLE users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			password TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'user',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE sources (
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
		`CREATE TABLE subscriptions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			url TEXT NOT NULL,
			auto_update BOOLEAN NOT NULL DEFAULT 0,
			interval INTEGER NOT NULL DEFAULT 3600,
			last_sync DATETIME,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL DEFAULT '',
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
	}
	for _, stmt := range legacySchema {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("create legacy schema: %v", err)
		}
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close legacy db: %v", err)
	}

	s, err := New(dbPath)
	if err != nil {
		t.Fatalf("open migrated store: %v", err)
	}
	defer func() { _ = s.Close() }()

	if !columnExists(t, s.db, "users", "avatar") {
		t.Fatal("expected users.avatar column after migration")
	}
	if !columnExists(t, s.db, "sources", "searchable") {
		t.Fatal("expected sources.searchable column after migration")
	}
}

func TestMigrateAddsOpaqueTokenAuthToExistingV5DB(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "settings-v5.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open v5 db: %v", err)
	}
	statements := []string{
		`CREATE TABLE users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			password TEXT NOT NULL,
			avatar TEXT DEFAULT '',
			role TEXT NOT NULL DEFAULT 'user',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE sources (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			key TEXT UNIQUE NOT NULL,
			name TEXT NOT NULL,
			api TEXT NOT NULL,
			detail TEXT NOT NULL DEFAULT '',
			enabled BOOLEAN NOT NULL DEFAULT 1,
			searchable BOOLEAN NOT NULL DEFAULT 1,
			comment TEXT NOT NULL DEFAULT '',
			health TEXT NOT NULL DEFAULT 'unknown',
			last_check DATETIME,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE subscriptions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			url TEXT NOT NULL,
			auto_update BOOLEAN NOT NULL DEFAULT 0,
			interval INTEGER NOT NULL DEFAULT 3600,
			last_sync DATETIME,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL DEFAULT '',
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE schema_migrations (
			version INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`INSERT INTO schema_migrations (version, name) VALUES
			(1, 'create_core_tables'),
			(2, 'add_user_avatar'),
			(3, 'add_source_searchable'),
			(4, 'insert_default_settings'),
			(5, 'insert_public_base_url_setting')`,
	}
	for _, stmt := range statements {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("prepare v5 db: %v", err)
		}
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close v5 db: %v", err)
	}

	s, err := New(dbPath)
	if err != nil {
		t.Fatalf("open migrated v5 store: %v", err)
	}
	defer func() { _ = s.Close() }()

	for _, table := range []string{"auth_sessions", "media_tokens"} {
		var name string
		if err := s.db.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name=?", table).Scan(&name); err != nil {
			t.Fatalf("expected %s table after migration: %v", table, err)
		}
	}
	value, err := s.GetSetting(consts.SettingPlaybackMode)
	if err != nil {
		t.Fatalf("GetSetting playback_mode: %v", err)
	}
	if value != consts.PlaybackModeProxy {
		t.Fatalf("playback_mode = %q, want %q", value, consts.PlaybackModeProxy)
	}
}

func TestMigrationHelpersReportDatabaseErrors(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close db: %v", err)
	}
	if err := createMigrationTable(db); err == nil {
		t.Fatal("expected createMigrationTable to fail on closed database")
	}
	if _, err := migrationApplied(db, 1); err == nil {
		t.Fatal("expected migrationApplied to fail on closed database")
	}
}

func TestApplyMigrationPropagatesStepError(t *testing.T) {
	s := newTestStore(t)
	wantErr := errors.New("broken migration")
	err := s.applyMigration(migration{
		version: 99,
		name:    "broken",
		up: func(tx *sql.Tx) error {
			return wantErr
		},
	})
	if !errors.Is(err, wantErr) {
		t.Fatalf("applyMigration error = %v, want %v", err, wantErr)
	}
}

func columnExists(t *testing.T, db *sql.DB, table, column string) bool {
	t.Helper()
	rows, err := db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		t.Fatalf("table info %s: %v", table, err)
	}
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		var cid int
		var name, typ string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
			t.Fatalf("scan table info: %v", err)
		}
		if name == column {
			return true
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate table info: %v", err)
	}
	return false
}
