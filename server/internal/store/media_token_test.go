package store

import (
	"testing"
	"time"
)

func TestMediaTokenLifecycle(t *testing.T) {
	s := newTestStore(t)
	expires := time.Now().Add(30 * time.Minute)
	token, err := s.CreateMediaToken("media-hash", 7, "segment", "url-hash", "src", expires)
	if err != nil {
		t.Fatalf("CreateMediaToken: %v", err)
	}
	if token.Kind != "segment" || token.URLHash != "url-hash" {
		t.Fatalf("unexpected token: %+v", token)
	}

	got, err := s.GetValidMediaToken("media-hash", "segment", "url-hash")
	if err != nil {
		t.Fatalf("GetValidMediaToken: %v", err)
	}
	if got == nil || got.SourceKey != "src" {
		t.Fatalf("expected valid media token, got %+v", got)
	}
	if err := s.TouchMediaToken(got.ID); err != nil {
		t.Fatalf("TouchMediaToken: %v", err)
	}
	got, err = s.GetValidMediaToken("media-hash", "segment", "url-hash")
	if err != nil {
		t.Fatalf("GetValidMediaToken after touch: %v", err)
	}
	if got == nil || got.UsedAt == nil {
		t.Fatalf("expected used timestamp after touch, got %+v", got)
	}

	got, err = s.GetValidMediaToken("media-hash", "key", "url-hash")
	if err != nil {
		t.Fatalf("GetValidMediaToken wrong kind: %v", err)
	}
	if got != nil {
		t.Fatal("wrong kind should not validate")
	}
}

func TestDeleteExpiredTokens(t *testing.T) {
	s := newTestStore(t)
	userID, err := s.CreateUser("token_cleanup", "pass", "user")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if _, err := s.CreateAuthSession(userID, "expired-auth-cleanup", time.Now().Add(-time.Minute), "", ""); err != nil {
		t.Fatalf("CreateAuthSession expired: %v", err)
	}
	if _, err := s.CreateAuthSession(userID, "active-auth-cleanup", time.Now().Add(time.Hour), "", ""); err != nil {
		t.Fatalf("CreateAuthSession active: %v", err)
	}
	if _, err := s.CreateMediaToken("expired-media-cleanup", 0, "segment", "expired-url", "", time.Now().Add(-time.Minute)); err != nil {
		t.Fatalf("CreateMediaToken expired: %v", err)
	}
	if _, err := s.CreateMediaToken("active-media-cleanup", 0, "segment", "active-url", "", time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("CreateMediaToken active: %v", err)
	}

	if err := s.DeleteExpiredTokens(); err != nil {
		t.Fatalf("DeleteExpiredTokens: %v", err)
	}
	if got, _, err := s.GetValidAuthSessionByHash("active-auth-cleanup"); err != nil || got == nil {
		t.Fatalf("active auth token should remain, got=%+v err=%v", got, err)
	}
	if got, err := s.GetValidMediaToken("active-media-cleanup", "segment", "active-url"); err != nil || got == nil {
		t.Fatalf("active media token should remain, got=%+v err=%v", got, err)
	}
	if got, err := s.GetValidMediaToken("expired-media-cleanup", "segment", "expired-url"); err != nil || got != nil {
		t.Fatalf("expired media token should be gone, got=%+v err=%v", got, err)
	}
}

func TestMediaTokenRejectsExpired(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.CreateMediaToken("expired-media-hash", 0, "m3u8", "url-hash", "", time.Now().Add(-time.Minute)); err != nil {
		t.Fatalf("CreateMediaToken: %v", err)
	}
	got, err := s.GetValidMediaToken("expired-media-hash", "m3u8", "url-hash")
	if err != nil {
		t.Fatalf("GetValidMediaToken: %v", err)
	}
	if got != nil {
		t.Fatal("expired media token should not validate")
	}
}
