package store

import (
	"fmt"
	"testing"

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
