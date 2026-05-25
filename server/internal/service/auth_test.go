package service

import (
	"testing"
	"time"

	"github.com/mritd/kmtv/internal/model"
	"github.com/mritd/kmtv/internal/store"
)

func TestAuthServiceIssueAndVerifyAccessToken(t *testing.T) {
	s, err := store.New(":memory:")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	defer func() { _ = s.Close() }()
	userID, err := s.CreateUser("auth_user", "pass", "admin")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	user, err := s.GetUserByID(userID)
	if err != nil {
		t.Fatalf("GetUserByID: %v", err)
	}
	auth := NewAuthService(s)

	issued, err := auth.IssueAccessToken(user, time.Hour, "agent", "127.0.0.1")
	if err != nil {
		t.Fatalf("IssueAccessToken: %v", err)
	}
	if issued.Token == "" || issued.ExpiresAt.IsZero() || issued.SessionID == 0 {
		t.Fatalf("unexpected issued token: %+v", issued)
	}

	session, verifiedUser, err := auth.VerifyAccessToken(issued.Token)
	if err != nil {
		t.Fatalf("VerifyAccessToken: %v", err)
	}
	if session == nil || verifiedUser == nil || verifiedUser.Username != "auth_user" {
		t.Fatalf("expected verified user, got session=%+v user=%+v", session, verifiedUser)
	}
}

func TestAuthServiceRejectsRevokedToken(t *testing.T) {
	s, err := store.New(":memory:")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	defer func() { _ = s.Close() }()
	userID, err := s.CreateUser("revoked_user", "pass", "user")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	user := &model.User{ID: userID, Username: "revoked_user", Role: "user"}
	auth := NewAuthService(s)
	issued, err := auth.IssueAccessToken(user, time.Hour, "", "")
	if err != nil {
		t.Fatalf("IssueAccessToken: %v", err)
	}
	if err := auth.RevokeAccessToken(issued.Token); err != nil {
		t.Fatalf("RevokeAccessToken: %v", err)
	}
	session, verifiedUser, err := auth.VerifyAccessToken(issued.Token)
	if err != nil {
		t.Fatalf("VerifyAccessToken: %v", err)
	}
	if session != nil || verifiedUser != nil {
		t.Fatalf("revoked token should not verify, got session=%+v user=%+v", session, verifiedUser)
	}
}

func TestAuthServiceRejectsInvalidInputsAndRevokesUserTokens(t *testing.T) {
	s, err := store.New(":memory:")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	defer func() { _ = s.Close() }()
	userID, err := s.CreateUser("revoke_all_user", "pass", "user")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	user, err := s.GetUserByID(userID)
	if err != nil {
		t.Fatalf("GetUserByID: %v", err)
	}
	auth := NewAuthService(s)

	if _, err := auth.IssueAccessToken(nil, time.Hour, "", ""); err == nil {
		t.Fatal("expected nil user error")
	}
	if _, err := auth.IssueAccessToken(user, 0, "", ""); err == nil {
		t.Fatal("expected ttl error")
	}
	if err := auth.RevokeAccessToken("not-base58-0"); err != nil {
		t.Fatalf("invalid token revoke should be ignored, got %v", err)
	}

	issued, err := auth.IssueAccessToken(user, time.Hour, "", "")
	if err != nil {
		t.Fatalf("IssueAccessToken: %v", err)
	}
	if _, verifiedUser, err := auth.VerifyAccessToken(issued.Token); err != nil || verifiedUser == nil {
		t.Fatalf("expected token before revoke all, user=%+v err=%v", verifiedUser, err)
	}
	if err := auth.RevokeUserAccessTokens(user.ID); err != nil {
		t.Fatalf("RevokeUserAccessTokens: %v", err)
	}
	if session, verifiedUser, err := auth.VerifyAccessToken(issued.Token); err != nil || session != nil || verifiedUser != nil {
		t.Fatalf("expected revoked token to fail, session=%+v user=%+v err=%v", session, verifiedUser, err)
	}
}

func TestAuthServiceInvalidateUserCacheReloadsUser(t *testing.T) {
	s, err := store.New(":memory:")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	defer func() { _ = s.Close() }()
	userID, err := s.CreateUser("cache_user", "pass", "admin")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	user, err := s.GetUserByID(userID)
	if err != nil {
		t.Fatalf("GetUserByID: %v", err)
	}
	auth := NewAuthService(s)
	issued, err := auth.IssueAccessToken(user, time.Hour, "", "")
	if err != nil {
		t.Fatalf("IssueAccessToken: %v", err)
	}
	if _, verifiedUser, err := auth.VerifyAccessToken(issued.Token); err != nil || verifiedUser == nil || verifiedUser.Role != "admin" {
		t.Fatalf("expected cached admin user, user=%+v err=%v", verifiedUser, err)
	}

	if err := s.UpdateUserFull(userID, "cache_user", "user", ""); err != nil {
		t.Fatalf("UpdateUserFull: %v", err)
	}
	auth.InvalidateUserCache(userID)
	if _, verifiedUser, err := auth.VerifyAccessToken(issued.Token); err != nil || verifiedUser == nil || verifiedUser.Role != "user" {
		t.Fatalf("expected refreshed user role, user=%+v err=%v", verifiedUser, err)
	}
}

func TestAuthServiceStoreFailures(t *testing.T) {
	s, err := store.New(":memory:")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	userID, err := s.CreateUser("auth_store_failure", "pass", "user")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	user, err := s.GetUserByID(userID)
	if err != nil {
		t.Fatalf("GetUserByID: %v", err)
	}
	auth := NewAuthService(s)
	issued, err := auth.IssueAccessToken(user, time.Hour, "", "")
	if err != nil {
		t.Fatalf("IssueAccessToken before close: %v", err)
	}
	auth.InvalidateUserCache(userID)
	if err := s.Close(); err != nil {
		t.Fatalf("Close store: %v", err)
	}

	if _, err := auth.IssueAccessToken(user, time.Hour, "", ""); err == nil {
		t.Fatal("expected IssueAccessToken to fail after store close")
	}
	if _, _, err := auth.VerifyAccessToken(issued.Token); err == nil {
		t.Fatal("expected VerifyAccessToken to fail after store close")
	}
	if err := auth.RevokeAccessToken(issued.Token); err == nil {
		t.Fatal("expected RevokeAccessToken to fail after store close")
	}
	if err := auth.RevokeUserAccessTokens(userID); err == nil {
		t.Fatal("expected RevokeUserAccessTokens to fail after store close")
	}
}

func TestAuthServiceVerifyInvalidTokenError(t *testing.T) {
	auth := NewAuthService(newServiceTestStore(t))
	session, user, err := auth.VerifyAccessToken("not-base58-0")
	if err != nil || session != nil || user != nil {
		t.Fatalf("invalid token should be ignored, session=%+v user=%+v err=%v", session, user, err)
	}
}
