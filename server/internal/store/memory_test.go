package store

import (
	"sync"
	"testing"

	"github.com/mritd/kmtv/internal/model"
)

// TestIsMemoryDSN covers the predicate that routes New into in-memory mode.
// TestIsMemoryDSN 覆盖将 New 路由到内存模式的判定谓词.
func TestIsMemoryDSN(t *testing.T) {
	tests := []struct {
		name string
		dsn  string
		want bool
	}{
		{"bare memory", ":memory:", true},
		{"uri mode memory", "file:kmtv?mode=memory&cache=shared", true},
		{"relative file path", "kmtv.db", false},
		{"absolute file path", "/data/kmtv.db", false},
		{"empty", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsMemoryDSN(tt.dsn); got != tt.want {
				t.Errorf("IsMemoryDSN(%q) = %v, want %v", tt.dsn, got, tt.want)
			}
		})
	}
}

// TestMemoryStore_SharedAcrossBorrows verifies a :memory: store keeps a single
// in-memory database across separate database/sql borrows. A write on one call
// must be visible on a later call; without the single-connection pin, a plain
// :memory: DB is private per connection and the read would see an empty DB.
// TestMemoryStore_SharedAcrossBorrows 验证 :memory: store 在多次 database/sql
// 借还之间共享同一个内存库. 一次调用的写入必须在后续调用可见; 没有单连接钉死,
// 纯 :memory: 库是每连接私有的, 读取会看到空库.
func TestMemoryStore_SharedAcrossBorrows(t *testing.T) {
	s, err := New(":memory:")
	if err != nil {
		t.Fatalf("open memory store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	id, err := s.CreateSource(&model.Source{
		Key:  "mem-1",
		Name: "Mem 1",
		API:  "https://example.com/api-1",
	})
	if err != nil {
		t.Fatalf("create source: %v", err)
	}

	// A separate call performs a separate borrow from the pool; it must still
	// observe the same in-memory database.
	// 另一次调用会从连接池另行借用连接, 仍须观察到同一个内存库.
	got, err := s.GetSourceByID(id)
	if err != nil {
		t.Fatalf("get source back: %v", err)
	}
	if got == nil || got.Key != "mem-1" {
		t.Fatalf("source not visible on subsequent borrow; memory DB not shared")
	}
}

// TestMemoryStore_ConcurrentAccess proves the single pinned connection lets
// concurrent reads/writes on a :memory: store complete without error or data
// loss. It would deadlock or drop rows if the connection pinning were wrong.
// TestMemoryStore_ConcurrentAccess 证明单条钉死连接下, :memory: store 的并发读写
// 全部成功且不丢数据. 若连接钉死有误, 会死锁或丢行.
func TestMemoryStore_ConcurrentAccess(t *testing.T) {
	s, err := New(":memory:")
	if err != nil {
		t.Fatalf("open memory store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	const writers = 50
	var wg sync.WaitGroup
	results := make([]error, writers)
	wg.Add(writers)
	for i := 0; i < writers; i++ {
		go func(i int) {
			defer wg.Done()
			_, err := s.CreateSource(&model.Source{
				Key:  "conc-" + itoa(i),
				Name: "Conc " + itoa(i),
				API:  "https://example.com/api-" + itoa(i),
			})
			results[i] = err
		}(i)
	}
	wg.Wait()

	for i, e := range results {
		if e != nil {
			t.Errorf("concurrent CreateSource %d failed: %v", i, e)
		}
	}

	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM sources`).Scan(&count); err != nil {
		t.Fatalf("count sources: %v", err)
	}
	if count != writers {
		t.Fatalf("sources count = %d, want %d (rows lost or DB not shared)", count, writers)
	}
}
