package store

import (
	"errors"
	"testing"

	"github.com/mritd/kmtv/internal/errs"
)

func TestCreateSubscription(t *testing.T) {
	s := newTestStore(t)

	id, err := s.CreateSubscription("https://example.com/config.json", true, 3600)
	if err != nil {
		t.Fatalf("CreateSubscription error: %v", err)
	}
	if id <= 0 {
		t.Errorf("expected positive ID, got %d", id)
	}

	sub, err := s.GetSubscriptionByID(id)
	if err != nil {
		t.Fatalf("GetSubscriptionByID error: %v", err)
	}
	if sub == nil {
		t.Fatal("expected subscription, got nil")
		return
	}
	if sub.URL != "https://example.com/config.json" {
		t.Errorf("expected url, got %q", sub.URL)
	}
	if !sub.AutoUpdate {
		t.Error("expected auto_update=true")
	}
	if sub.Interval != 3600 {
		t.Errorf("expected interval=3600, got %d", sub.Interval)
	}
	if !sub.LastSync.IsZero() {
		t.Errorf("expected zero last_sync, got %v", sub.LastSync)
	}
}

func TestListSubscriptions(t *testing.T) {
	s := newTestStore(t)

	_, err := s.CreateSubscription("https://a.com/config.json", true, 1800)
	if err != nil {
		t.Fatalf("CreateSubscription error: %v", err)
	}
	_, err = s.CreateSubscription("https://b.com/config.json", false, 7200)
	if err != nil {
		t.Fatalf("CreateSubscription error: %v", err)
	}

	subs, err := s.ListSubscriptions()
	if err != nil {
		t.Fatalf("ListSubscriptions error: %v", err)
	}
	if len(subs) != 2 {
		t.Fatalf("expected 2 subscriptions, got %d", len(subs))
	}
	if subs[0].URL != "https://a.com/config.json" {
		t.Errorf("expected first sub url, got %q", subs[0].URL)
	}
	if subs[1].URL != "https://b.com/config.json" {
		t.Errorf("expected second sub url, got %q", subs[1].URL)
	}
}

func TestDeleteSubscription(t *testing.T) {
	s := newTestStore(t)

	id, err := s.CreateSubscription("https://temp.com/config.json", false, 3600)
	if err != nil {
		t.Fatalf("CreateSubscription error: %v", err)
	}

	if err := s.DeleteSubscription(id); err != nil {
		t.Fatalf("DeleteSubscription error: %v", err)
	}

	sub, err := s.GetSubscriptionByID(id)
	if err != nil {
		t.Fatalf("GetSubscriptionByID after delete error: %v", err)
	}
	if sub != nil {
		t.Errorf("expected nil after delete, got %+v", sub)
	}
}

func TestUpdateSubscriptionAndLastSync(t *testing.T) {
	s := newTestStore(t)

	id, err := s.CreateSubscription("https://old.example/config.json", false, 3600)
	if err != nil {
		t.Fatalf("CreateSubscription error: %v", err)
	}

	if err := s.UpdateSubscription(id, "https://new.example/config.json", true, 7200); err != nil {
		t.Fatalf("UpdateSubscription error: %v", err)
	}
	if err := s.UpdateSubscriptionLastSync(id); err != nil {
		t.Fatalf("UpdateSubscriptionLastSync error: %v", err)
	}

	sub, err := s.GetSubscriptionByID(id)
	if err != nil {
		t.Fatalf("GetSubscriptionByID error: %v", err)
	}
	if sub.URL != "https://new.example/config.json" || !sub.AutoUpdate || sub.Interval != 7200 {
		t.Fatalf("subscription was not updated: %+v", sub)
	}
	if sub.LastSync.IsZero() {
		t.Fatal("expected last_sync to be set")
	}
}

func TestUpdateSubscriptionMissing(t *testing.T) {
	s := newTestStore(t)

	if err := s.UpdateSubscription(9999, "https://missing.example/config.json", true, 60); !errors.Is(err, errs.ErrNotFound) {
		t.Fatalf("expected ErrNotFound from UpdateSubscription, got %v", err)
	}
	if err := s.DeleteSubscription(9999); !errors.Is(err, errs.ErrNotFound) {
		t.Fatalf("expected ErrNotFound from DeleteSubscription, got %v", err)
	}
}
