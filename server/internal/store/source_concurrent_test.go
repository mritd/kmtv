package store

import (
	"errors"
	"path/filepath"
	"strconv"
	"sync"
	"testing"

	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
)

// TestUpdateSource_ConcurrentWritesDoNotBusy is a regression guard for the
// SQLITE_BUSY storm that hit "启用 🔞 源" before the ConnectionHook fix.
// PRAGMA busy_timeout is per-connection in SQLite, so the previous one-shot
// db.Exec("PRAGMA busy_timeout=5000") only configured the first connection.
// Later connections opened by database/sql defaulted to busy_timeout=0, and
// concurrent UPDATEs racing for the WAL writer lock returned SQLITE_BUSY (5)
// instead of queuing for ~5 s as the WAL writer was held.
// This test fans out N goroutines that each UPDATE a distinct source row on a
// real file-backed database. With the connection hook in place every new
// pooled connection inherits busy_timeout=5000 and the writes serialize
// cleanly. Without the hook, most updates fail.
// TestUpdateSource_ConcurrentWritesDoNotBusy 是 "启用 🔞 源" SQLITE_BUSY 风暴的回归护栏.
// PRAGMA busy_timeout 是连接级的, 之前一次性的 db.Exec 只配置了第一条借出的连接,
// database/sql 池后续按需创建的连接会回退到 busy_timeout=0,
// 并发 UPDATE 在 WAL 写锁竞争时立即返回 SQLITE_BUSY (5), 而不是排队等待 ~5s.
// 这个测试在真实文件数据库上对不同 id 启动 N 个 goroutine 并发 UpdateSource.
// 有连接钩子时, 池中每条新连接继承 busy_timeout=5000, 写串行但全部成功.
// 没有钩子时, 大多数 UPDATE 会失败.
func TestUpdateSource_ConcurrentWritesDoNotBusy(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "concurrent.db")
	s, err := New(dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	const writers = 50
	ids := make([]int64, writers)
	for i := 0; i < writers; i++ {
		src := &model.Source{
			Key:     "key-" + itoa(i),
			Name:    "Source " + itoa(i),
			API:     "https://example.com/api-" + itoa(i),
			Enabled: false,
		}
		id, err := s.CreateSource(src)
		if err != nil {
			t.Fatalf("seed source %d: %v", i, err)
		}
		ids[i] = id
	}

	var wg sync.WaitGroup
	results := make([]error, writers)
	wg.Add(writers)
	for i := 0; i < writers; i++ {
		go func(i int) {
			defer wg.Done()
			results[i] = s.UpdateSource(ids[i], "Updated "+itoa(i), "https://example.com/api-"+itoa(i), "", "", true)
		}(i)
	}
	wg.Wait()

	for i, e := range results {
		if e != nil {
			t.Errorf("goroutine %d UpdateSource failed: %v", i, e)
		}
	}
}

// TestBulkSetSourcesEnabled_AtomicAndIdempotent verifies the new bulk endpoint
// flips many rows in one transaction, and that an unknown id rolls back the
// entire batch.
// TestBulkSetSourcesEnabled_AtomicAndIdempotent 验证批量端点在单事务里翻转多行,
// 且其中存在未知 id 时整批回滚, 数据库保持未修改状态.
func TestBulkSetSourcesEnabled_AtomicAndIdempotent(t *testing.T) {
	s := newTestStore(t)

	const n = 10
	ids := make([]int64, n)
	for i := 0; i < n; i++ {
		id, err := s.CreateSource(&model.Source{
			Key:     "bulk-" + itoa(i),
			Name:    "Bulk " + itoa(i),
			API:     "https://example.com/api-" + itoa(i),
			Enabled: false,
		})
		if err != nil {
			t.Fatalf("seed source %d: %v", i, err)
		}
		ids[i] = id
	}

	if err := s.BulkSetSourcesEnabled(ids, true); err != nil {
		t.Fatalf("BulkSetSourcesEnabled (enable): %v", err)
	}
	for _, id := range ids {
		got, err := s.GetSourceByID(id)
		if err != nil {
			t.Fatalf("GetSourceByID %d: %v", id, err)
		}
		if !got.Enabled {
			t.Errorf("source %d expected enabled=true after bulk enable", id)
		}
	}

	// Empty input is a no-op.
	// 空输入是 no-op.
	if err := s.BulkSetSourcesEnabled(nil, true); err != nil {
		t.Errorf("BulkSetSourcesEnabled(nil) = %v, want nil", err)
	}

	// A missing id rolls back the entire batch: previously-enabled rows stay enabled.
	// 含有不存在的 id 时整批回滚: 已启用的行保持启用状态.
	withMissing := append([]int64{}, ids...)
	withMissing = append(withMissing, 99999)
	err := s.BulkSetSourcesEnabled(withMissing, false)
	if err == nil {
		t.Fatal("expected error for batch with missing id, got nil")
	}
	if !errors.Is(err, errs.ErrNotFound) {
		t.Errorf("expected error wrapping ErrNotFound, got %v", err)
	}
	for _, id := range ids {
		got, err := s.GetSourceByID(id)
		if err != nil {
			t.Fatalf("GetSourceByID %d after rollback: %v", id, err)
		}
		if !got.Enabled {
			t.Errorf("source %d should still be enabled after rollback, got enabled=%v", id, got.Enabled)
		}
	}
}

func itoa(i int) string { return strconv.Itoa(i) }
