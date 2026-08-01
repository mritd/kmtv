package store

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
)

func TestWatchHistoryUpsertDedupeByTitle(t *testing.T) {
	s := newTestStore(t)
	userID, err := s.CreateUser("history_user", "pass", "user")
	if err != nil {
		t.Fatalf("CreateUser error: %v", err)
	}

	first, err := s.UpsertWatchHistory(userID, &model.WatchHistoryItem{
		Title:        " Demo Show ",
		SourceKey:    "source-a",
		VideoID:      "1",
		Episode:      "E1",
		EpisodeIndex: 0,
		ProgressSec:  60,
		DurationSec:  1200,
		EventTimeMS:  1000,
	})
	if err != nil {
		t.Fatalf("first UpsertWatchHistory error: %v", err)
	}
	if first.Title != "Demo Show" || first.TitleKey != "demo show" {
		t.Fatalf("title normalization failed: %+v", first)
	}

	second, err := s.UpsertWatchHistory(userID, &model.WatchHistoryItem{
		Title:        "demo show",
		SourceKey:    "source-b",
		VideoID:      "2",
		Episode:      "E2",
		EpisodeIndex: 1,
		ProgressSec:  90,
		DurationSec:  1200,
		EventTimeMS:  2000,
	})
	if err != nil {
		t.Fatalf("second UpsertWatchHistory error: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("expected same row to be updated, got first=%d second=%d", first.ID, second.ID)
	}
	if second.SourceKey != "source-b" || second.VideoID != "2" || second.EpisodeIndex != 1 {
		t.Fatalf("history row was not updated: %+v", second)
	}

	items, err := s.ListWatchHistory(userID, 10, nil)
	if err != nil {
		t.Fatalf("ListWatchHistory error: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected one deduped item, got %d", len(items))
	}
}

func TestWatchHistoryIsPerUser(t *testing.T) {
	s := newTestStore(t)
	userA, err := s.CreateUser("history_a", "pass", "user")
	if err != nil {
		t.Fatalf("CreateUser A error: %v", err)
	}
	userB, err := s.CreateUser("history_b", "pass", "user")
	if err != nil {
		t.Fatalf("CreateUser B error: %v", err)
	}

	for _, userID := range []int64{userA, userB} {
		if _, err := s.UpsertWatchHistory(userID, &model.WatchHistoryItem{
			Title:       "Shared Title",
			SourceKey:   fmt.Sprintf("source-%d", userID),
			VideoID:     fmt.Sprintf("%d", userID),
			ProgressSec: float64(userID),
			DurationSec: 1000,
			EventTimeMS: userID,
		}); err != nil {
			t.Fatalf("UpsertWatchHistory user %d error: %v", userID, err)
		}
	}

	gotA, err := s.GetWatchHistoryByTitle(userA, "shared title")
	if err != nil {
		t.Fatalf("GetWatchHistoryByTitle A error: %v", err)
	}
	gotB, err := s.GetWatchHistoryByTitle(userB, "shared title")
	if err != nil {
		t.Fatalf("GetWatchHistoryByTitle B error: %v", err)
	}
	if gotA.SourceKey == gotB.SourceKey {
		t.Fatalf("expected per-user rows, got A=%+v B=%+v", gotA, gotB)
	}
}

func TestWatchHistoryCompletionAndTrim(t *testing.T) {
	s := newTestStore(t)
	userID, err := s.CreateUser("history_trim", "pass", "user")
	if err != nil {
		t.Fatalf("CreateUser error: %v", err)
	}

	nonFinal, err := s.UpsertWatchHistory(userID, &model.WatchHistoryItem{
		Title:       "Non-final Episode",
		ProgressSec: 970,
		DurationSec: 1000,
		EventTimeMS: 1,
	})
	if err != nil {
		t.Fatalf("UpsertWatchHistory non-final error: %v", err)
	}
	if nonFinal.Completed {
		t.Fatalf("server must not infer title completion from one episode: %+v", nonFinal)
	}
	done, err := s.UpsertWatchHistory(userID, &model.WatchHistoryItem{
		Title:       "Almost Done",
		ProgressSec: 970,
		DurationSec: 1000,
		Completed:   true,
		EventTimeMS: 2,
	})
	if err != nil {
		t.Fatalf("UpsertWatchHistory completion error: %v", err)
	}
	if !done.Completed {
		t.Fatalf("expected completed=true near end: %+v", done)
	}

	for i := 0; i < MaxWatchHistoryItems+5; i++ {
		if _, err := s.UpsertWatchHistory(userID, &model.WatchHistoryItem{
			Title:       fmt.Sprintf("Title %03d", i),
			SourceKey:   "src",
			VideoID:     fmt.Sprintf("%d", i),
			ProgressSec: float64(i + 1),
			DurationSec: 1000,
			EventTimeMS: int64(i + 3),
		}); err != nil {
			t.Fatalf("UpsertWatchHistory %d error: %v", i, err)
		}
	}

	items, err := s.ListWatchHistory(userID, MaxWatchHistoryItems+50, nil)
	if err != nil {
		t.Fatalf("ListWatchHistory error: %v", err)
	}
	if len(items) != MaxWatchHistoryItems {
		t.Fatalf("expected trimmed list length %d, got %d", MaxWatchHistoryItems, len(items))
	}
	if items[0].Title != "Title 104" {
		t.Fatalf("expected newest item first, got %+v", items[0])
	}
}

func TestWatchHistoryClearAndDelete(t *testing.T) {
	s := newTestStore(t)
	userID, err := s.CreateUser("history_clear", "pass", "user")
	if err != nil {
		t.Fatalf("CreateUser error: %v", err)
	}
	if _, err := s.UpsertWatchHistory(userID, &model.WatchHistoryItem{Title: "A", EventTimeMS: 1}); err != nil {
		t.Fatalf("upsert A: %v", err)
	}
	if _, err := s.UpsertWatchHistory(userID, &model.WatchHistoryItem{Title: "B", EventTimeMS: 2}); err != nil {
		t.Fatalf("upsert B: %v", err)
	}
	if err := s.DeleteWatchHistoryByTitle(userID, "a"); err != nil {
		t.Fatalf("DeleteWatchHistoryByTitle error: %v", err)
	}
	if got, err := s.GetWatchHistoryByTitle(userID, "A"); err != nil || got != nil {
		t.Fatalf("expected A deleted, got %+v err=%v", got, err)
	}
	if err := s.ClearWatchHistory(userID, 3); err != nil {
		t.Fatalf("ClearWatchHistory error: %v", err)
	}
	items, err := s.ListWatchHistory(userID, 10, nil)
	if err != nil {
		t.Fatalf("ListWatchHistory after clear error: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("expected empty list after clear, got %+v", items)
	}
}

func TestWatchHistoryRejectsStaleWritesAndFiltersBeforeLimit(t *testing.T) {
	s := newTestStore(t)
	userID, err := s.CreateUser("history_order", "pass", "user")
	if err != nil {
		t.Fatalf("CreateUser error: %v", err)
	}
	if _, err := s.UpsertWatchHistory(userID, &model.WatchHistoryItem{
		Title: "Ordered", ProgressSec: 50, EventTimeMS: 200,
	}); err != nil {
		t.Fatalf("new write: %v", err)
	}
	if _, err := s.UpsertWatchHistory(userID, &model.WatchHistoryItem{
		Title: "Ordered", ProgressSec: 10, EventTimeMS: 100,
	}); err == nil {
		t.Fatal("expected stale write rejection")
	}
	got, err := s.GetWatchHistoryByTitle(userID, "Ordered")
	if err != nil || got.ProgressSec != 50 {
		t.Fatalf("stale write changed history: got=%+v err=%v", got, err)
	}
	for i := 0; i < 10; i++ {
		if _, err := s.UpsertWatchHistory(userID, &model.WatchHistoryItem{
			Title: fmt.Sprintf("Completed %d", i), Completed: true, EventTimeMS: int64(300 + i),
		}); err != nil {
			t.Fatalf("completed write %d: %v", i, err)
		}
	}
	incomplete := false
	items, err := s.ListWatchHistory(userID, 1, &incomplete)
	if err != nil || len(items) != 1 || items[0].Title != "Ordered" {
		t.Fatalf("filter must run before limit: items=%+v err=%v", items, err)
	}
}

func TestWatchHistoryClearRejectsOlderInflightWrite(t *testing.T) {
	s := newTestStore(t)
	userID, err := s.CreateUser("history_epoch", "pass", "user")
	if err != nil {
		t.Fatalf("CreateUser error: %v", err)
	}
	if err := s.ClearWatchHistory(userID, 200); err != nil {
		t.Fatalf("ClearWatchHistory error: %v", err)
	}
	if _, err := s.UpsertWatchHistory(userID, &model.WatchHistoryItem{Title: "Old", EventTimeMS: 100}); err == nil {
		t.Fatal("expected pre-clear write rejection")
	}
	if _, err := s.UpsertWatchHistory(userID, &model.WatchHistoryItem{Title: "New", EventTimeMS: 300}); err != nil {
		t.Fatalf("post-clear write: %v", err)
	}
}

func TestDeleteUserCascadesWatchHistory(t *testing.T) {
	s := newTestStore(t)
	userID, err := s.CreateUser("history_delete_user", "pass", "user")
	if err != nil {
		t.Fatalf("CreateUser error: %v", err)
	}
	if _, err := s.UpsertWatchHistory(userID, &model.WatchHistoryItem{Title: "Private", EventTimeMS: 1}); err != nil {
		t.Fatalf("UpsertWatchHistory error: %v", err)
	}
	if err := s.DeleteUser(userID); err != nil {
		t.Fatalf("DeleteUser error: %v", err)
	}
	item, err := s.GetWatchHistoryByTitle(userID, "Private")
	if err != nil || item != nil {
		t.Fatalf("expected cascaded history deletion, item=%+v err=%v", item, err)
	}
}

// TestWatchHistoryUpsertTrimmedRowReportsStale guards the case where the row
// written by an upsert falls outside the retained window and is trimmed inside
// the same transaction. The write did not survive, so the caller must see a
// stale-write error instead of a nil item that the handler would serialize as
// a 200 response with a null body.
// TestWatchHistoryUpsertTrimmedRowReportsStale 覆盖 upsert 写入的行落在保留窗口
// 之外, 并在同一事务中被裁剪的情况. 写入并未留存, 调用方必须收到 stale 错误,
// 而不是一个 nil 条目 (handler 会把它序列化成响应体为 null 的 200).
func TestWatchHistoryUpsertTrimmedRowReportsStale(t *testing.T) {
	s := newTestStore(t)
	userID, err := s.CreateUser("trim_user", "pass", "user")
	if err != nil {
		t.Fatalf("CreateUser error: %v", err)
	}

	// Fill the retained window with newer events.
	// 用更新的事件填满保留窗口.
	for i := 0; i < MaxWatchHistoryItems; i++ {
		if _, err := s.UpsertWatchHistory(userID, &model.WatchHistoryItem{
			Title:       fmt.Sprintf("newer-%d", i),
			EventTimeMS: int64(100_000 + i),
		}); err != nil {
			t.Fatalf("seed %d: %v", i, err)
		}
	}

	item, err := s.UpsertWatchHistory(userID, &model.WatchHistoryItem{
		Title:       "older-straggler",
		EventTimeMS: 1_000,
	})
	if item != nil {
		t.Fatalf("expected no item for a trimmed write, got %+v", item)
	}
	if !errors.Is(err, errs.ErrStaleWrite) {
		t.Fatalf("expected ErrStaleWrite for a trimmed write, got %v", err)
	}
}

// TestWatchHistoryClearClampsFutureTombstone guards against a client clock
// running ahead: a future clear timestamp must be clamped to server time so the
// user's own later writes are still accepted.
// TestWatchHistoryClearClampsFutureTombstone 防止客户端时钟走快: 未来的清空
// 时间戳必须被钳回服务端时间, 使该用户后续的写入仍能被接受.
func TestWatchHistoryClearClampsFutureTombstone(t *testing.T) {
	s := newTestStore(t)
	userID, err := s.CreateUser("clock_user", "pass", "user")
	if err != nil {
		t.Fatalf("CreateUser error: %v", err)
	}

	now := time.Now().UnixMilli()
	// A device whose clock is one hour ahead clears its history.
	// 一台时钟快一小时的设备清空了自己的历史.
	if err := s.ClearWatchHistory(userID, now+3_600_000); err != nil {
		t.Fatalf("ClearWatchHistory error: %v", err)
	}

	// A write made shortly after the clear must be accepted. With the future
	// tombstone left unclamped this would stay rejected for a full hour.
	// 清空之后不久的写入必须被接受. 如果未来墓碑没有被钳位, 这条写入会在
	// 整整一小时内持续被拒绝.
	item, err := s.UpsertWatchHistory(userID, &model.WatchHistoryItem{
		Title:       "after-clear",
		EventTimeMS: now + 60_000,
	})
	if err != nil {
		t.Fatalf("write after clamped clear should succeed, got %v", err)
	}
	if item == nil || item.Title != "after-clear" {
		t.Fatalf("unexpected item after clamped clear: %+v", item)
	}
}

// TestWatchHistoryIndexMatchesQueryOrder verifies migration v10 replaced the
// updated_at index with one matching the event_time_ms sort every query uses.
// TestWatchHistoryIndexMatchesQueryOrder 验证 migration v10 用与查询排序
// (event_time_ms) 匹配的索引替换了原先基于 updated_at 的索引.
func TestWatchHistoryIndexMatchesQueryOrder(t *testing.T) {
	s := newTestStore(t)

	var stale int
	if err := s.db.QueryRow(
		`SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_watch_history_user_updated'`,
	).Scan(&stale); err != nil {
		t.Fatalf("query stale index: %v", err)
	}
	if stale != 0 {
		t.Errorf("expected the updated_at index to be dropped, still present")
	}

	var sql string
	if err := s.db.QueryRow(
		`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_watch_history_user_event'`,
	).Scan(&sql); err != nil {
		t.Fatalf("expected the event_time_ms index to exist: %v", err)
	}
	if !strings.Contains(sql, "event_time_ms") {
		t.Errorf("index does not key on event_time_ms: %s", sql)
	}
}
