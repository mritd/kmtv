package store

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"sync"
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

func TestPushSyncClearRejectsOlderWrites(t *testing.T) {
	s := newTestStore(t)
	user := newSyncTestUser(t, s, "sync_clear")
	pushOne(t, s, user, syncSearch("Alpha", 1000))
	pushOne(t, s, user, syncDelete(model.SyncKindSearch, "Gone", 1200))
	pushOne(t, s, user, syncSearch("Beta", 3000))

	res := pushOne(t, s, user, syncClear(model.SyncKindSearch, 2000))
	if res.Status != model.SyncStatusApplied || res.Clear == nil || res.Clear.ClearedAtMS != 2000 {
		t.Fatalf("clear: %+v", res)
	}
	page, err := s.PullSyncChanges(user, 0, 100)
	if err != nil {
		t.Fatalf("PullSyncChanges: %v", err)
	}
	if len(page.Records) != 1 || page.Records[0].Key != "beta" {
		t.Fatalf("only the row newer than the clear may remain, tombstones included: %+v", page.Records)
	}
	res = pushOne(t, s, user, syncSearch("Alpha", 1500))
	if res.Status != model.SyncStatusStale || res.Record != nil {
		t.Fatalf("write before the clear must be stale with no row: %+v", res)
	}
	res = pushOne(t, s, user, syncClear(model.SyncKindSearch, 1800))
	if res.Status != model.SyncStatusStale || res.Clear == nil || res.Clear.ClearedAtMS != 2000 {
		t.Fatalf("older clear must be stale and return the current clear: %+v", res)
	}
}

func TestPushSyncTrimsSearchAndWatch(t *testing.T) {
	s := newTestStore(t)
	user := newSyncTestUser(t, s, "sync_trim")
	changes := make([]model.SyncChange, 0, SyncMaxSearchRecords+1)
	for i := range SyncMaxSearchRecords + 1 {
		changes = append(changes, syncSearch(fmt.Sprintf("q%03d", i), int64(1000+i)))
	}
	if _, _, err := s.PushSyncChanges(user, changes, syncTestNow); err != nil {
		t.Fatalf("PushSyncChanges: %v", err)
	}
	page, err := s.PullSyncChanges(user, 0, 1000)
	if err != nil {
		t.Fatalf("PullSyncChanges: %v", err)
	}
	live := map[string]bool{}
	trimmed := map[string]bool{}
	for _, r := range page.Records {
		if r.Deleted {
			trimmed[r.Key] = true
		} else {
			live[r.Key] = true
		}
	}
	if len(live) != SyncMaxSearchRecords || live["q000"] || !trimmed["q000"] {
		t.Fatalf("expected the oldest search trimmed into a tombstone, live=%d trimmed=%v", len(live), trimmed)
	}
	res := pushOne(t, s, user, syncSearch("too old", 10))
	if res.Status != model.SyncStatusStale || res.Record == nil || !res.Record.Deleted || res.Record.EventTimeMS != 10 {
		t.Fatalf("an incoming row that is trimmed at once must be stale with its tombstone: %+v", res)
	}
	if res := pushOne(t, s, user, syncSearch("too old", 9)); res.Status != model.SyncStatusStale {
		t.Fatalf("an older replay of a trimmed row must stay stale: %+v", res)
	}

	watch := make([]model.SyncChange, 0, SyncMaxWatchRecords+1)
	for i := range SyncMaxWatchRecords + 1 {
		watch = append(watch, syncWatch(fmt.Sprintf("t%03d", i), int64(5000+i)))
	}
	if _, _, err := s.PushSyncChanges(user, watch, syncTestNow); err != nil {
		t.Fatalf("PushSyncChanges watch: %v", err)
	}
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM sync_records WHERE user_id = ? AND kind = 'watch' AND deleted = 0`, user).Scan(&count); err != nil {
		t.Fatalf("count watch: %v", err)
	}
	if count != SyncMaxWatchRecords {
		t.Fatalf("watch rows = %d, want %d", count, SyncMaxWatchRecords)
	}
}

func TestPushSyncConcurrentWritersOnFileDB(t *testing.T) {
	// In-memory stores use one connection, so only a file database shows lock upgrades.
	//
	// 内存存储只使用一个连接, 只有文件数据库才能暴露锁升级问题.
	s, err := New(filepath.Join(t.TempDir(), "sync.db"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	users := []int64{newSyncTestUser(t, s, "sync_conc_a"), newSyncTestUser(t, s, "sync_conc_b")}

	errCh := make(chan error, 400)
	var wg sync.WaitGroup
	for g := range 4 {
		wg.Go(func() {
			user := users[g%2]
			for i := range 100 {
				change := syncSearch(fmt.Sprintf("g%d-%03d", g, i), int64(1000+g*1000+i))
				if _, _, err := s.PushSyncChanges(user, []model.SyncChange{change}, syncTestNow); err != nil {
					errCh <- err
				}
			}
		})
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Fatalf("concurrent push: %v", err)
	}
	if _, err := s.PurgeSyncTombstones(syncTestNow.Add(time.Hour)); err != nil {
		t.Fatalf("PurgeSyncTombstones: %v", err)
	}
}

func TestPullSyncPagesInRevOrder(t *testing.T) {
	s := newTestStore(t)
	user := newSyncTestUser(t, s, "sync_pull")
	if _, _, err := s.PushSyncChanges(user, []model.SyncChange{
		syncWatch("A", 1000),
		syncSearch("q", 1001),
		syncClear(model.SyncKindFavorite, 1002),
		syncWatch("B", 1003),
	}, syncTestNow); err != nil {
		t.Fatalf("PushSyncChanges: %v", err)
	}

	page, err := s.PullSyncChanges(user, 0, 2)
	if err != nil {
		t.Fatalf("pull 1: %v", err)
	}
	if !page.HasMore || page.Rev != 2 || len(page.Records) != 2 || len(page.Clears) != 0 ||
		page.Records[0].Key != "a" || page.Records[1].Key != "q" {
		t.Fatalf("page 1: %+v", page)
	}
	page, err = s.PullSyncChanges(user, page.Rev, 2)
	if err != nil {
		t.Fatalf("pull 2: %v", err)
	}
	if page.HasMore || page.Rev != 4 || len(page.Clears) != 1 || page.Clears[0].Kind != model.SyncKindFavorite ||
		len(page.Records) != 1 || page.Records[0].Key != "b" {
		t.Fatalf("page 2: %+v", page)
	}
	page, err = s.PullSyncChanges(user, 4, 2)
	if err != nil {
		t.Fatalf("pull 3: %v", err)
	}
	if page.HasMore || page.Reset || page.Rev != 4 || len(page.Records) != 0 || page.Records == nil || page.Clears == nil {
		t.Fatalf("empty page must keep the cursor and use empty slices: %+v", page)
	}
}

func TestPullSyncResetsWhenCursorIsAhead(t *testing.T) {
	s := newTestStore(t)
	user := newSyncTestUser(t, s, "sync_ahead")
	pushOne(t, s, user, syncWatch("A", 1000))

	page, err := s.PullSyncChanges(user, 5, 100)
	if err != nil {
		t.Fatalf("PullSyncChanges: %v", err)
	}
	if !page.Reset || page.Rev != 1 {
		t.Fatalf("a cursor beyond the server rev must reset and report the current rev: %+v", page)
	}
	page, err = s.PullSyncChanges(newSyncTestUser(t, s, "sync_new"), 0, 100)
	if err != nil || page.Reset {
		t.Fatalf("a brand-new user pulling from 0 must not reset: %+v, %v", page, err)
	}
}

func TestPurgeSyncTombstonesRaisesMinRev(t *testing.T) {
	s := newTestStore(t)
	user := newSyncTestUser(t, s, "sync_gc")
	pushOne(t, s, user, syncFavorite("Keep", 1000))
	pushOne(t, s, user, syncDelete(model.SyncKindFavorite, "gone", 1001))

	purged, err := s.PurgeSyncTombstones(syncTestNow)
	if err != nil || purged != 0 {
		t.Fatalf("tombstones written at the cutoff must stay: purged=%d err=%v", purged, err)
	}
	purged, err = s.PurgeSyncTombstones(syncTestNow.Add(time.Millisecond))
	if err != nil || purged != 1 {
		t.Fatalf("expected one purged tombstone, got %d (err %v)", purged, err)
	}

	page, err := s.PullSyncChanges(user, 1, 100)
	if err != nil || !page.Reset || page.Rev != 2 {
		t.Fatalf("since below min_rev must reset and report the current rev: %+v, %v", page, err)
	}
	page, err = s.PullSyncChanges(user, 2, 100)
	if err != nil || page.Reset {
		t.Fatalf("since at min_rev must not reset: %+v, %v", page, err)
	}
	page, err = s.PullSyncChanges(user, 0, 100)
	if err != nil || page.Reset || len(page.Records) != 1 || page.Records[0].Key != "keep" {
		t.Fatalf("full pull after GC: %+v, %v", page, err)
	}
}
