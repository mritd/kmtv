package service

import (
	"errors"
	"testing"
	"time"

	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
	"github.com/mritd/kmtv/internal/store"
)

func TestSyncServiceLifecycle(t *testing.T) {
	s, err := store.New(":memory:")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	svc := NewSyncService(s)
	if err := svc.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if err := svc.Start(); !errors.Is(err, errs.ErrServiceAlreadyStarted) {
		t.Fatalf("second Start = %v", err)
	}
	svc.Stop()
	svc.Stop()
	if err := svc.Start(); !errors.Is(err, errs.ErrServiceStopped) {
		t.Fatalf("Start after Stop = %v", err)
	}
}

func TestSyncServicePurgesExpiredTombstones(t *testing.T) {
	s, err := store.New(":memory:")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	user, err := s.CreateUser("sync_gc_svc", "pass", "user")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	written := time.UnixMilli(1_790_000_000_000)
	if _, _, err := s.PushSyncChanges(user, []model.SyncChange{
		{Kind: model.SyncKindSearch, Op: model.SyncOpDelete, Key: "old", EventTimeMS: 1000},
	}, written); err != nil {
		t.Fatalf("PushSyncChanges: %v", err)
	}

	svc := NewSyncService(s)
	svc.now = func() time.Time { return written.Add(SyncTombstoneTTL - time.Hour) }
	if n := svc.PurgeTombstones(); n != 0 {
		t.Fatalf("tombstone younger than the TTL must stay, purged %d", n)
	}
	svc.now = func() time.Time { return written.Add(SyncTombstoneTTL + time.Hour) }
	if n := svc.PurgeTombstones(); n != 1 {
		t.Fatalf("expired tombstone must be purged, purged %d", n)
	}
}
