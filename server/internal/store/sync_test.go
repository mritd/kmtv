package store

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/mritd/kmtv/internal/model"
)

func TestSyncEpochIsGeneratedPerDatabase(t *testing.T) {
	first := newTestStore(t)
	second := newTestStore(t)

	a, err := first.SyncEpoch()
	if err != nil || a == "" {
		t.Fatalf("first epoch = %q, err = %v", a, err)
	}
	again, err := first.SyncEpoch()
	if err != nil || again != a {
		t.Fatalf("epoch must be stable within one database: %q vs %q (err %v)", a, again, err)
	}
	b, err := second.SyncEpoch()
	if err != nil || b == "" || b == a {
		t.Fatalf("second database must get its own epoch: %q vs %q (err %v)", a, b, err)
	}
}

var syncTestNow = time.UnixMilli(1_790_000_000_000)

func newSyncTestUser(t *testing.T, s *Store, name string) int64 {
	t.Helper()
	id, err := s.CreateUser(name, "pass", "user")
	if err != nil {
		t.Fatalf("CreateUser(%q): %v", name, err)
	}
	return id
}

func syncUpsert(kind model.SyncKind, payload string, eventTime int64) model.SyncChange {
	return model.SyncChange{Kind: kind, Op: model.SyncOpUpsert, Payload: json.RawMessage(payload), EventTimeMS: eventTime}
}

func syncWatch(title string, eventTime int64) model.SyncChange {
	return syncUpsert(model.SyncKindWatch, fmt.Sprintf(`{"title":%q,"progress_sec":10,"duration_sec":100}`, title), eventTime)
}

func syncSearch(query string, eventTime int64) model.SyncChange {
	return syncUpsert(model.SyncKindSearch, fmt.Sprintf(`{"query":%q}`, query), eventTime)
}

func syncFavorite(title string, eventTime int64) model.SyncChange {
	return syncUpsert(model.SyncKindFavorite, fmt.Sprintf(`{"title":%q}`, title), eventTime)
}

func syncDelete(kind model.SyncKind, key string, eventTime int64) model.SyncChange {
	return model.SyncChange{Kind: kind, Op: model.SyncOpDelete, Key: key, EventTimeMS: eventTime}
}

func syncClear(kind model.SyncKind, eventTime int64) model.SyncChange {
	return model.SyncChange{Kind: kind, Op: model.SyncOpClear, EventTimeMS: eventTime}
}

func pushOne(t *testing.T, s *Store, userID int64, change model.SyncChange) model.SyncResult {
	t.Helper()
	_, results, err := s.PushSyncChanges(userID, []model.SyncChange{change}, syncTestNow)
	if err != nil {
		t.Fatalf("PushSyncChanges: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	return results[0]
}

func TestPushSyncUpsertNewerWins(t *testing.T) {
	s := newTestStore(t)
	user := newSyncTestUser(t, s, "sync_newer")

	res := pushOne(t, s, user, syncWatch("Demo Show", 1000))
	if res.Status != model.SyncStatusApplied || res.Record == nil || res.Record.Key != "demo show" || res.Record.Rev != 1 {
		t.Fatalf("first upsert: %+v", res)
	}
	res = pushOne(t, s, user, syncWatch("  demo   SHOW ", 1000))
	if res.Status != model.SyncStatusStale || res.Record.EventTimeMS != 1000 {
		t.Fatalf("equal event time must keep the existing row: %+v", res)
	}
	res = pushOne(t, s, user, syncWatch("DEMO show", 2000))
	if res.Status != model.SyncStatusApplied || res.Record.EventTimeMS != 2000 || res.Record.Rev != 2 {
		t.Fatalf("newer upsert: %+v", res)
	}
	res = pushOne(t, s, user, syncWatch("Demo Show", 1500))
	if res.Status != model.SyncStatusStale || res.Record.EventTimeMS != 2000 {
		t.Fatalf("older upsert must return the current row: %+v", res)
	}
}

func TestPushSyncReplayReturnsCurrentRecord(t *testing.T) {
	s := newTestStore(t)
	user := newSyncTestUser(t, s, "sync_replay")
	change := syncFavorite("Show X", 1000)

	first := pushOne(t, s, user, change)
	replay := pushOne(t, s, user, change)
	if first.Status != model.SyncStatusApplied || replay.Status != model.SyncStatusStale {
		t.Fatalf("statuses: first %s, replay %s", first.Status, replay.Status)
	}
	if replay.Record == nil || replay.Record.Rev != first.Record.Rev || string(replay.Record.Payload) != string(first.Record.Payload) {
		t.Fatalf("replay must return the unchanged record: first %+v, replay %+v", first.Record, replay.Record)
	}
}

func TestPushSyncDeleteWritesTombstone(t *testing.T) {
	s := newTestStore(t)
	user := newSyncTestUser(t, s, "sync_tombstone")

	res := pushOne(t, s, user, syncDelete(model.SyncKindFavorite, "  GHOST ", 1000))
	if res.Status != model.SyncStatusApplied || res.Record == nil || !res.Record.Deleted || res.Record.Key != "ghost" {
		t.Fatalf("delete without a row must still write a tombstone: %+v", res)
	}
	res = pushOne(t, s, user, syncFavorite("Ghost", 900))
	if res.Status != model.SyncStatusStale || res.Record == nil || !res.Record.Deleted {
		t.Fatalf("older upsert must lose to the tombstone: %+v", res)
	}
	res = pushOne(t, s, user, syncFavorite("Ghost", 1100))
	if res.Status != model.SyncStatusApplied || res.Record.Deleted {
		t.Fatalf("newer upsert must revive the key: %+v", res)
	}
}

func TestPushSyncClampsFutureEventTime(t *testing.T) {
	s := newTestStore(t)
	user := newSyncTestUser(t, s, "sync_clamp")

	res := pushOne(t, s, user, syncWatch("Fast Clock", syncTestNow.Add(time.Hour).UnixMilli()))
	if res.Status != model.SyncStatusApplied || res.Record.EventTimeMS != syncTestNow.UnixMilli() {
		t.Fatalf("far-future time must be clamped to server time: %+v", res)
	}
	res = pushOne(t, s, user, syncWatch("Fast Clock", syncTestNow.UnixMilli()+1))
	if res.Status != model.SyncStatusApplied {
		t.Fatalf("a device with a correct clock must win right after the clamp: %+v", res)
	}
	lead := syncTestNow.Add(500 * time.Millisecond).UnixMilli()
	res = pushOne(t, s, user, syncWatch("Small Lead", lead))
	if res.Record.EventTimeMS != lead {
		t.Fatalf("lead within one second must be kept: %+v", res)
	}
}

func TestPushSyncClampKeepsBatchOrder(t *testing.T) {
	s := newTestStore(t)
	user := newSyncTestUser(t, s, "sync_clamp_order")
	future := syncTestNow.Add(time.Hour).UnixMilli()

	_, results, err := s.PushSyncChanges(user, []model.SyncChange{
		syncClear(model.SyncKindSearch, future),
		syncSearch("After Clear", future+1),
	}, syncTestNow)
	if err != nil {
		t.Fatalf("PushSyncChanges: %v", err)
	}
	if results[0].Status != model.SyncStatusApplied || results[0].Clear.ClearedAtMS != syncTestNow.UnixMilli() {
		t.Fatalf("clear: %+v", results[0])
	}
	if results[1].Status != model.SyncStatusApplied || results[1].Record.EventTimeMS != syncTestNow.UnixMilli()+1 {
		t.Fatalf("an upsert after a clear in the same batch must survive the clamp: %+v", results[1])
	}
}

func TestPushSyncClampKeepsOrderAcrossThreshold(t *testing.T) {
	s := newTestStore(t)
	user := newSyncTestUser(t, s, "sync_clamp_straddle")
	now := syncTestNow.UnixMilli()

	_, results, err := s.PushSyncChanges(user, []model.SyncChange{
		syncClear(model.SyncKindSearch, now+900),
		syncSearch("Straddle", now+1100),
	}, syncTestNow)
	if err != nil {
		t.Fatalf("PushSyncChanges: %v", err)
	}
	if results[0].Status != model.SyncStatusApplied || results[0].Clear.ClearedAtMS != now {
		t.Fatalf("clear below the limit must be remapped with the batch: %+v", results[0])
	}
	if results[1].Status != model.SyncStatusApplied || results[1].Record.EventTimeMS != now+1 {
		t.Fatalf("upsert after the clear must survive: %+v", results[1])
	}
}

func TestPushSyncFavoriteLimit(t *testing.T) {
	s := newTestStore(t)
	user := newSyncTestUser(t, s, "sync_limit")
	changes := make([]model.SyncChange, 0, SyncMaxFavoriteRecords)
	for i := range SyncMaxFavoriteRecords {
		changes = append(changes, syncFavorite(fmt.Sprintf("Fav %04d", i), int64(1000+i)))
	}
	if _, _, err := s.PushSyncChanges(user, changes, syncTestNow); err != nil {
		t.Fatalf("PushSyncChanges: %v", err)
	}
	res := pushOne(t, s, user, syncFavorite("One Too Many", 9000))
	if res.Status != model.SyncStatusLimit {
		t.Fatalf("new favorite beyond the cap must be rejected: %+v", res)
	}
	res = pushOne(t, s, user, syncFavorite("Fav 0000", 9001))
	if res.Status != model.SyncStatusApplied {
		t.Fatalf("updating an existing favorite must still work at the cap: %+v", res)
	}
}

func TestPushSyncInvalidDoesNotFailBatch(t *testing.T) {
	s := newTestStore(t)
	user := newSyncTestUser(t, s, "sync_invalid")
	_, results, err := s.PushSyncChanges(user, []model.SyncChange{
		{Kind: "bogus", Op: model.SyncOpUpsert, Payload: json.RawMessage(`{"title":"A"}`), EventTimeMS: 1},
		syncWatch("", 2),
		{Kind: model.SyncKindWatch, Op: "merge", EventTimeMS: 3},
		syncWatch("Valid", 0),
		syncDelete(model.SyncKindSearch, "   ", 4),
		syncWatch("Valid", 5),
	}, syncTestNow)
	if err != nil {
		t.Fatalf("PushSyncChanges: %v", err)
	}
	for i := range 5 {
		if results[i].Status != model.SyncStatusInvalid || results[i].Reason == "" || results[i].Index != i {
			t.Fatalf("result %d should be invalid with a reason: %+v", i, results[i])
		}
	}
	if results[5].Status != model.SyncStatusApplied || results[5].Index != 5 {
		t.Fatalf("valid change after invalid ones must apply: %+v", results[5])
	}
}

func TestPushSyncIsolatesUsers(t *testing.T) {
	s := newTestStore(t)
	alice := newSyncTestUser(t, s, "sync_alice")
	bob := newSyncTestUser(t, s, "sync_bob")
	pushOne(t, s, alice, syncFavorite("Shared Title", 1000))

	res := pushOne(t, s, bob, syncFavorite("Shared Title", 500))
	if res.Status != model.SyncStatusApplied || res.Record.Rev != 1 {
		t.Fatalf("another user's row must not affect this user: %+v", res)
	}
}

func TestDeleteUserRemovesSyncData(t *testing.T) {
	s := newTestStore(t)
	user := newSyncTestUser(t, s, "sync_cascade")
	pushOne(t, s, user, syncFavorite("Show", 1000))
	pushOne(t, s, user, syncClear(model.SyncKindSearch, 1001))

	if err := s.DeleteUser(user); err != nil {
		t.Fatalf("DeleteUser: %v", err)
	}
	for _, table := range []string{"sync_records", "sync_clears", "sync_users"} {
		var count int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM `+table+` WHERE user_id = ?`, user).Scan(&count); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if count != 0 {
			t.Fatalf("%s keeps %d rows of a deleted user", table, count)
		}
	}
}
