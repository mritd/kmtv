package store

import (
	"testing"
	"time"
)

func TestAuthSessionLifecycle(t *testing.T) {
	s := newTestStore(t)
	userID, err := s.CreateUser("token_user", "pass", "admin")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	expires := time.Now().Add(time.Hour)

	session, err := s.CreateAuthSession(userID, "hash-a", expires, "agent", "127.0.0.1")
	if err != nil {
		t.Fatalf("CreateAuthSession: %v", err)
	}
	if session.TokenHash != "hash-a" || session.UserID != userID {
		t.Fatalf("unexpected session: %+v", session)
	}

	got, user, err := s.GetValidAuthSessionByHash("hash-a")
	if err != nil {
		t.Fatalf("GetValidAuthSessionByHash: %v", err)
	}
	if got == nil || user == nil || user.Username != "token_user" {
		t.Fatalf("expected valid session and user, got session=%+v user=%+v", got, user)
	}
	if err := s.TouchAuthSession(got.ID); err != nil {
		t.Fatalf("TouchAuthSession: %v", err)
	}
	got, _, err = s.GetValidAuthSessionByHash("hash-a")
	if err != nil {
		t.Fatalf("GetValidAuthSessionByHash after touch: %v", err)
	}
	if got == nil || got.LastSeenAt == nil {
		t.Fatalf("expected last seen timestamp after touch, got %+v", got)
	}

	if err := s.RevokeAuthSessionByHash("hash-a"); err != nil {
		t.Fatalf("RevokeAuthSessionByHash: %v", err)
	}
	got, user, err = s.GetValidAuthSessionByHash("hash-a")
	if err != nil {
		t.Fatalf("GetValidAuthSessionByHash after revoke: %v", err)
	}
	if got != nil || user != nil {
		t.Fatalf("revoked token should not be valid, got session=%+v user=%+v", got, user)
	}
}

func TestAuthSessionExpiredAndRevokeAll(t *testing.T) {
	s := newTestStore(t)
	userID, err := s.CreateUser("token_user_2", "pass", "user")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if _, err := s.CreateAuthSession(userID, "expired-hash", time.Now().Add(-time.Minute), "", ""); err != nil {
		t.Fatalf("CreateAuthSession expired: %v", err)
	}
	if _, err := s.CreateAuthSession(userID, "active-hash", time.Now().Add(time.Hour), "", ""); err != nil {
		t.Fatalf("CreateAuthSession active: %v", err)
	}
	got, _, err := s.GetValidAuthSessionByHash("expired-hash")
	if err != nil {
		t.Fatalf("GetValidAuthSessionByHash expired: %v", err)
	}
	if got != nil {
		t.Fatal("expired session should not be valid")
	}
	if err := s.RevokeAuthSessionsByUser(userID); err != nil {
		t.Fatalf("RevokeAuthSessionsByUser: %v", err)
	}
	got, _, err = s.GetValidAuthSessionByHash("active-hash")
	if err != nil {
		t.Fatalf("GetValidAuthSessionByHash active after revoke: %v", err)
	}
	if got != nil {
		t.Fatal("user revoked session should not be valid")
	}
}
