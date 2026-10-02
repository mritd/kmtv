package handler

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"net/url"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/mritd/kmtv/internal/model"
)

// simClock hands out strictly increasing event times shared by all simulated devices.
//
// simClock 为所有模拟设备分配严格递增的事件时间.
type simClock struct{ now int64 }

func (c *simClock) next() int64 {
	c.now++
	return c.now
}

type simRecord struct {
	kind      model.SyncKind
	key       string
	payload   json.RawMessage
	eventTime int64
	deleted   bool
	dirty     bool
	synced    bool
}

// simDevice is a minimal client that follows the spec's local-store and sync-cycle rules.
//
// simDevice 是按 spec 中本地存储与同步流程规则实现的最小客户端.
type simDevice struct {
	t         *testing.T
	name      string
	clock     *simClock
	r         http.Handler
	bearer    string
	epoch     string
	cursor    int64
	records   map[string]*simRecord
	clears    map[model.SyncKind]int64
	reuploads int // restores detected, for assertions
}

func newSimDevice(t *testing.T, name string, clock *simClock, r http.Handler, bearer string) *simDevice {
	return &simDevice{
		t: t, name: name, clock: clock, r: r, bearer: bearer,
		records: map[string]*simRecord{},
		clears:  map[model.SyncKind]int64{},
	}
}

func simID(kind model.SyncKind, key string) string { return string(kind) + "|" + key }

func (d *simDevice) upsert(kind model.SyncKind, payload string) {
	d.t.Helper()
	key, canonical, err := model.NormalizeSyncPayload(kind, json.RawMessage(payload))
	if err != nil {
		d.t.Fatalf("%s upsert: %v", d.name, err)
	}
	id := simID(kind, key)
	synced := d.records[id] != nil && d.records[id].synced
	d.records[id] = &simRecord{kind: kind, key: key, payload: canonical, eventTime: d.clock.next(), dirty: true, synced: synced}
}

func (d *simDevice) remove(kind model.SyncKind, key string) {
	id := simID(kind, model.NormalizeSyncKey(key))
	rec := d.records[id]
	if rec == nil {
		rec = &simRecord{kind: kind, key: model.NormalizeSyncKey(key)}
		d.records[id] = rec
	}
	rec.deleted, rec.dirty, rec.eventTime, rec.payload = true, true, d.clock.next(), json.RawMessage(`{}`)
}

func (d *simDevice) clear(kind model.SyncKind) {
	at := d.clock.next()
	for id, rec := range d.records {
		if rec.kind == kind && rec.eventTime <= at {
			delete(d.records, id)
		}
	}
	d.clears[kind] = at
}

func (d *simDevice) adopt(id string, remote *model.SyncRecord) {
	if remote == nil || remote.Deleted {
		delete(d.records, id)
		return
	}
	d.records[id] = &simRecord{kind: remote.Kind, key: remote.Key, payload: remote.Payload, eventTime: remote.EventTimeMS, synced: true}
}

// markForReupload makes every local record dirty and restarts pulling from 0, so the server
// receives this device's data again.
//
// markForReupload 把所有本地记录标记为待推送并从 0 重新拉取, 让服务端重新收到本设备的数据.
func (d *simDevice) markForReupload() {
	for _, rec := range d.records {
		rec.dirty, rec.synced = true, false
	}
	d.cursor = 0
}

func (d *simDevice) resetForNewEpoch(epoch string) {
	d.markForReupload()
	d.epoch = epoch
}

// sync runs push then pull; a server reset restarts the cycle.
//
// sync 先推送再拉取; 服务端重置时重新开始本轮.
func (d *simDevice) sync() {
	d.t.Helper()
	for range 3 {
		pushed := d.push()
		if d.pull() && pushed {
			return
		}
	}
	d.t.Fatalf("%s: sync did not settle", d.name)
}

func (d *simDevice) push() bool {
	d.t.Helper()
	var changes []model.SyncChange
	var targets []string
	for _, kind := range slices.Sorted(maps.Keys(d.clears)) {
		changes = append(changes, model.SyncChange{Kind: kind, Op: model.SyncOpClear, EventTimeMS: d.clears[kind]})
		targets = append(targets, "")
	}
	for _, id := range slices.Sorted(maps.Keys(d.records)) {
		rec := d.records[id]
		if !rec.dirty {
			continue
		}
		change := model.SyncChange{Kind: rec.kind, EventTimeMS: rec.eventTime}
		if rec.deleted {
			change.Op, change.Key = model.SyncOpDelete, rec.key
		} else {
			change.Op, change.Payload = model.SyncOpUpsert, rec.payload
		}
		changes = append(changes, change)
		targets = append(targets, id)
	}
	if len(changes) == 0 {
		return true
	}
	rec := performSyncRequest(d.t, d.r, http.MethodPost, "/api/v1/sync/push", d.bearer, map[string]any{
		"epoch": d.epoch, "cursor": d.cursor, "changes": changes,
	})
	if rec.Code == http.StatusConflict {
		// Both 409 kinds are resolved by the pull: a new epoch re-marks local data, and a cursor
		// ahead of the server gets a same-epoch reset whose rev is below the cursor, which
		// re-marks local data as well.
		//
		// 两种 409 都由拉取解决: 新 epoch 会重新标记本地数据; 游标超前会得到同 epoch 且 rev
		// 低于游标的 reset, 同样会重新标记本地数据.
		return false
	}
	if rec.Code != http.StatusOK {
		d.t.Fatalf("%s push: %d %s", d.name, rec.Code, rec.Body.String())
	}
	resp := decodeSync[struct {
		Epoch   string             `json:"epoch"`
		Results []model.SyncResult `json:"results"`
	}](d.t, rec)
	d.epoch = resp.Epoch
	for _, res := range resp.Results {
		change := changes[res.Index]
		if change.Op == model.SyncOpClear {
			if d.clears[change.Kind] == change.EventTimeMS {
				delete(d.clears, change.Kind)
			}
			continue
		}
		id := targets[res.Index]
		local := d.records[id]
		if local == nil || local.eventTime != change.EventTimeMS {
			continue // edited again while the push was in flight
		}
		switch res.Status {
		case model.SyncStatusApplied:
			if local.deleted {
				delete(d.records, id)
				continue
			}
			local.eventTime, local.dirty, local.synced = res.Record.EventTimeMS, false, true
		case model.SyncStatusStale:
			d.adopt(id, res.Record)
		case model.SyncStatusInvalid:
			local.dirty = false
		case model.SyncStatusLimit:
			delete(d.records, id)
		}
	}
	return true
}

func (d *simDevice) pull() bool {
	d.t.Helper()
	full := false
	// Every page of a chain that started at since=0 sends full=1, as the clients do.
	//
	// 从 since=0 开始的拉取链每页都带 full=1, 与客户端一致.
	fromZero := d.cursor == 0
	seen := map[string]bool{}
	for {
		path := fmt.Sprintf("/api/v1/sync/pull?since=%d&epoch=%s&limit=2", d.cursor, url.QueryEscape(d.epoch))
		if fromZero {
			path += "&full=1"
		}
		rec := performSyncRequest(d.t, d.r, http.MethodGet, path, d.bearer, nil)
		if rec.Code != http.StatusOK {
			d.t.Fatalf("%s pull: %d %s", d.name, rec.Code, rec.Body.String())
		}
		page := decodeSync[syncPullResponse](d.t, rec)
		if page.Reset {
			switch {
			case d.epoch != "" && page.Epoch != d.epoch:
				d.resetForNewEpoch(page.Epoch)
				return false
			case page.Rev < d.cursor:
				// The server lost revisions this device has seen: it was restored from an older copy.
				//
				// 服务端丢失了本设备见过的版本: 它从旧副本恢复过.
				d.reuploads++
				d.markForReupload()
				return false
			}
			d.cursor, full, fromZero, seen = 0, true, true, map[string]bool{}
			continue
		}
		d.epoch = page.Epoch
		for _, c := range page.Clears {
			for id, local := range d.records {
				if local.kind == c.Kind && local.eventTime <= c.ClearedAtMS {
					delete(d.records, id)
				}
			}
		}
		for _, remote := range page.Records {
			id := simID(remote.Kind, remote.Key)
			if !remote.Deleted {
				seen[id] = true
			}
			if pending, ok := d.clears[remote.Kind]; ok && remote.EventTimeMS <= pending {
				continue // already removed by a clear that is not pushed yet
			}
			local := d.records[id]
			switch {
			case local == nil:
				if !remote.Deleted {
					d.adopt(id, &remote)
				}
			case !local.dirty, remote.EventTimeMS > local.eventTime:
				d.adopt(id, &remote)
			}
		}
		d.cursor = page.Rev
		if !page.HasMore {
			break
		}
	}
	if full {
		for id, local := range d.records {
			if local.synced && !local.dirty && !seen[id] {
				delete(d.records, id)
			}
		}
	}
	return true
}

func (d *simDevice) live() map[string]string {
	out := map[string]string{}
	for id, rec := range d.records {
		if !rec.deleted {
			out[id] = string(rec.payload)
		}
	}
	return out
}

func assertConverged(t *testing.T, a, b *simDevice, want ...string) {
	t.Helper()
	la, lb := a.live(), b.live()
	ids := slices.Sorted(maps.Keys(la))
	if strings.Join(ids, ",") != strings.Join(want, ",") {
		t.Fatalf("%s live = %v, want %v", a.name, ids, want)
	}
	for _, id := range ids {
		if la[id] != lb[id] {
			t.Fatalf("%s differs on %s: %s vs %s", b.name, id, la[id], lb[id])
		}
	}
	if len(lb) != len(la) {
		t.Fatalf("%s has %d live records, %s has %d", a.name, len(la), b.name, len(lb))
	}
}

// snapshotSyncDB copies the database at dsn to dst, the way a backup would.
//
// snapshotSyncDB 像备份一样把 dsn 上的数据库复制到 dst.
func snapshotSyncDB(t *testing.T, dsn, dst string) {
	t.Helper()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		t.Fatalf("open %s: %v", dsn, err)
	}
	defer func() { _ = db.Close() }()
	if _, err := db.Exec(`VACUUM INTO ?`, dst); err != nil {
		t.Fatalf("snapshot %s: %v", dsn, err)
	}
}

func TestSyncTwoDevicesConverge(t *testing.T) {
	dir := t.TempDir()
	live := filepath.Join(dir, "live.db")
	h1, r1 := setupTestHandlerAt(t, live)
	createTestUser(t, h1, "sync_e2e", "pass", "user")
	clock := &simClock{now: 1_700_000_000_000}
	a := newSimDevice(t, "A", clock, r1, loginAndGetBearer(t, r1, "sync_e2e", "pass"))
	b := newSimDevice(t, "B", clock, r1, loginAndGetBearer(t, r1, "sync_e2e", "pass"))

	// Both devices learn each other's data.
	a.upsert(model.SyncKindSearch, `{"query":"Alpha"}`)
	a.upsert(model.SyncKindFavorite, `{"title":"Show X","year":"2020"}`)
	a.sync()
	b.sync()
	assertConverged(t, a, b, "favorite|show x", "search|alpha")

	// An offline delete on B loses to a newer edit on A.
	b.remove(model.SyncKindFavorite, "Show X")
	b.upsert(model.SyncKindSearch, `{"query":"Beta"}`)
	a.upsert(model.SyncKindFavorite, `{"title":"show x","year":"2021"}`)
	a.sync()
	b.sync()
	a.sync()
	assertConverged(t, a, b, "favorite|show x", "search|alpha", "search|beta")
	if !strings.Contains(b.live()["favorite|show x"], "2021") {
		t.Fatalf("B must adopt A's newer favorite, got %s", b.live()["favorite|show x"])
	}

	// A clear removes older entries everywhere, including B's later-synced add.
	b.upsert(model.SyncKindSearch, `{"query":"Gamma"}`)
	a.clear(model.SyncKindSearch)
	b.sync()
	a.sync()
	b.sync()
	assertConverged(t, a, b, "favorite|show x")

	// A search written after the clear survives.
	b.upsert(model.SyncKindSearch, `{"query":"Delta"}`)
	b.sync()
	a.sync()
	assertConverged(t, a, b, "favorite|show x", "search|delta")

	// Restore from an older copy with the same epoch. The server loses Epsilon and A's cursor is
	// now ahead of the server rev: A's push is rejected, the pull reports a rev below the cursor,
	// and A uploads its data again, so Epsilon comes back instead of being dropped.
	//
	// 以相同 epoch 从旧副本恢复. 服务端丢失 Epsilon, A 的游标领先于服务端 rev: A 的推送被拒绝,
	// 拉取返回低于游标的 rev, A 重新上传本地数据, Epsilon 得以恢复而不是被删除.
	backup := filepath.Join(dir, "backup.db")
	snapshotSyncDB(t, live, backup)
	a.upsert(model.SyncKindSearch, `{"query":"Epsilon"}`)
	a.sync()
	b.sync()
	_, r3 := setupTestHandlerAt(t, backup)
	a.r, a.bearer = r3, loginAndGetBearer(t, r3, "sync_e2e", "pass")
	b.r, b.bearer = r3, loginAndGetBearer(t, r3, "sync_e2e", "pass")
	a.upsert(model.SyncKindSearch, `{"query":"Zeta"}`)
	a.sync()
	b.sync()
	if a.reuploads != 1 {
		t.Fatalf("A must detect the restore once, got %d", a.reuploads)
	}
	assertConverged(t, a, b, "favorite|show x", "search|delta", "search|epsilon", "search|zeta")

	// Server reset: a fresh database with a new epoch receives the devices' data again.
	h2, r2 := setupTestHandler(t)
	createTestUser(t, h2, "sync_e2e", "pass", "user")
	a.r, a.bearer = r2, loginAndGetBearer(t, r2, "sync_e2e", "pass")
	b.r, b.bearer = r2, loginAndGetBearer(t, r2, "sync_e2e", "pass")
	a.upsert(model.SyncKindWatch, `{"title":"Movie","episode_index":1,"progress_sec":42,"duration_sec":100}`)
	a.sync()
	b.sync()
	a.sync()
	assertConverged(t, a, b, "favorite|show x", "search|delta", "search|epsilon", "search|zeta", "watch|movie")
}
