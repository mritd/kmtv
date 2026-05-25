package store

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/mritd/kmtv/internal/errs"
	"modernc.org/sqlite"
)

// busyTimeoutMillis is applied to every new SQLite connection so concurrent
// writers queue against the WAL writer lock instead of failing with SQLITE_BUSY.
// busyTimeoutMillis 应用到每条新连接, 让并发写者在 WAL 写锁上排队, 而不是立即返回 SQLITE_BUSY.
const busyTimeoutMillis = 5000

func init() {
	// PRAGMA busy_timeout is per-connection in SQLite, so setting it once via
	// db.Exec only affects the connection that happens to be checked out at
	// that moment. database/sql later opens additional connections on demand,
	// and those default to busy_timeout=0, which surfaces as SQLITE_BUSY under
	// concurrent writes. A connection hook reliably configures every new conn.
	// PRAGMA busy_timeout 是连接级设置, 通过 db.Exec 一次性写入只对当时借出的
	// 那条连接生效; 池中后续按需创建的连接会回退到 busy_timeout=0, 并发写时
	// 立刻返回 SQLITE_BUSY. 连接钩子能保证每条新连接都正确配置.
	sqlite.RegisterConnectionHook(func(conn sqlite.ExecQuerierContext, _ string) error {
		query := fmt.Sprintf("PRAGMA busy_timeout=%d", busyTimeoutMillis)
		if _, err := conn.ExecContext(context.Background(), query, nil); err != nil {
			return fmt.Errorf("set busy timeout: %w", err)
		}
		return nil
	})
}

// checkRowsAffected returns ErrNotFound if no rows were affected.
// checkRowsAffected 在没有行被影响时返回 ErrNotFound.
func checkRowsAffected(result sql.Result) error {
	n, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check rows affected: %w", err)
	}
	if n == 0 {
		return errs.ErrNotFound
	}
	return nil
}

// Store wraps a SQLite database connection.
// Store 封装 SQLite 数据库连接.
type Store struct {
	db *sql.DB
}

// New opens a SQLite database at the given path and runs migrations.
// New 打开指定路径的 SQLite 数据库并执行迁移.
func New(dsn string) (*Store, error) {
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("enable WAL mode: %w", err)
	}

	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("run migrations: %w", err)
	}

	return s, nil
}

// Close closes the underlying database connection.
// Close 关闭底层数据库连接.
func (s *Store) Close() error {
	return s.db.Close()
}
