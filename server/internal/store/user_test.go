package store

import (
	"errors"
	"testing"

	"github.com/mritd/kmtv/internal/errs"
)

func TestCreateUser(t *testing.T) {
	s := newTestStore(t)

	id, err := s.CreateUser("alice", "secret123", "admin")
	if err != nil {
		t.Fatalf("CreateUser error: %v", err)
	}
	if id <= 0 {
		t.Errorf("expected positive ID, got %d", id)
	}

	u, err := s.GetUserByID(id)
	if err != nil {
		t.Fatalf("GetUserByID error: %v", err)
	}
	if u == nil {
		t.Fatal("expected user, got nil")
		return
	}
	if u.Username != "alice" {
		t.Errorf("expected username=alice, got %q", u.Username)
	}
	if u.Role != "admin" {
		t.Errorf("expected role=admin, got %q", u.Role)
	}
	// Password should be hashed, not plaintext.
	if u.Password == "secret123" {
		t.Error("password stored as plaintext")
	}
}

func TestCreateUser_Duplicate(t *testing.T) {
	s := newTestStore(t)

	_, err := s.CreateUser("bob", "pass1", "user")
	if err != nil {
		t.Fatalf("first CreateUser error: %v", err)
	}

	_, err = s.CreateUser("bob", "pass2", "user")
	if err == nil {
		t.Error("expected error for duplicate username, got nil")
	}
	if !errors.Is(err, errs.ErrUsernameTaken) {
		t.Fatalf("expected ErrUsernameTaken, got %v", err)
	}
}

func TestGetUserByUsername(t *testing.T) {
	s := newTestStore(t)

	_, err := s.CreateUser("charlie", "pass", "user")
	if err != nil {
		t.Fatalf("CreateUser error: %v", err)
	}

	u, err := s.GetUserByUsername("charlie")
	if err != nil {
		t.Fatalf("GetUserByUsername error: %v", err)
	}
	if u == nil {
		t.Fatal("expected user, got nil")
		return
	}
	if u.Username != "charlie" {
		t.Errorf("expected username=charlie, got %q", u.Username)
	}

	// Non-existent user returns nil.
	u, err = s.GetUserByUsername("nonexistent")
	if err != nil {
		t.Fatalf("GetUserByUsername error for nonexistent: %v", err)
	}
	if u != nil {
		t.Errorf("expected nil for nonexistent user, got %+v", u)
	}
}

func TestVerifyPassword(t *testing.T) {
	s := newTestStore(t)

	_, err := s.CreateUser("dave", "correcthorse", "user")
	if err != nil {
		t.Fatalf("CreateUser error: %v", err)
	}

	u, err := s.GetUserByUsername("dave")
	if err != nil {
		t.Fatalf("GetUserByUsername error: %v", err)
	}

	if !CheckPassword(u.Password, "correcthorse") {
		t.Error("expected password to match")
	}
	if CheckPassword(u.Password, "wrongpassword") {
		t.Error("expected password mismatch")
	}
}

func TestListUsers(t *testing.T) {
	s := newTestStore(t)

	_, err := s.CreateUser("user1", "pass1", "admin")
	if err != nil {
		t.Fatalf("CreateUser error: %v", err)
	}
	_, err = s.CreateUser("user2", "pass2", "user")
	if err != nil {
		t.Fatalf("CreateUser error: %v", err)
	}

	users, err := s.ListUsers()
	if err != nil {
		t.Fatalf("ListUsers error: %v", err)
	}
	if len(users) != 2 {
		t.Fatalf("expected 2 users, got %d", len(users))
	}
	if users[0].Username != "user1" {
		t.Errorf("expected first user=user1, got %q", users[0].Username)
	}
	if users[1].Username != "user2" {
		t.Errorf("expected second user=user2, got %q", users[1].Username)
	}
}

func TestDeleteUser(t *testing.T) {
	s := newTestStore(t)

	id, err := s.CreateUser("ephemeral", "pass", "user")
	if err != nil {
		t.Fatalf("CreateUser error: %v", err)
	}

	if err := s.DeleteUser(id); err != nil {
		t.Fatalf("DeleteUser error: %v", err)
	}

	u, err := s.GetUserByID(id)
	if err != nil {
		t.Fatalf("GetUserByID after delete error: %v", err)
	}
	if u != nil {
		t.Errorf("expected nil after delete, got %+v", u)
	}
}

func TestValidateUsername(t *testing.T) {
	tests := []struct {
		name     string
		username string
		wantErr  bool
	}{
		{"valid simple", "alice", false},
		{"valid with numbers", "user123", false},
		{"valid with dash", "my-user", false},
		{"valid with underscore", "my_user", false},
		{"empty", "", true},
		{"too long", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", true},
		{"contains colon", "user:name", true},
		{"contains space", "user name", true},
		{"contains at", "user@host", true},
		{"contains chinese", "用户", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateUsername(tt.username)
			if tt.wantErr && err == nil {
				t.Errorf("expected error for %q", tt.username)
			}
			if !tt.wantErr && err != nil {
				t.Errorf("unexpected error for %q: %v", tt.username, err)
			}
		})
	}
}

func TestCreateUser_InvalidUsername(t *testing.T) {
	s := newTestStore(t)
	_, err := s.CreateUser("user:colon", "password", "user")
	if err == nil {
		t.Error("expected error creating user with colon in name")
	}
	if !errors.Is(err, errs.ErrInvalidUsername) {
		t.Fatalf("expected ErrInvalidUsername, got %v", err)
	}
}

func TestUpdateUserAndPassword(t *testing.T) {
	s := newTestStore(t)

	id, err := s.CreateUser("rename_me", "oldpass", "user")
	if err != nil {
		t.Fatalf("CreateUser error: %v", err)
	}
	if err := s.UpdateUser(id, "renamed", "admin"); err != nil {
		t.Fatalf("UpdateUser error: %v", err)
	}
	if err := s.UpdateUserPassword(id, "newpass"); err != nil {
		t.Fatalf("UpdateUserPassword error: %v", err)
	}

	u, err := s.GetUserByID(id)
	if err != nil {
		t.Fatalf("GetUserByID error: %v", err)
	}
	if u.Username != "renamed" || u.Role != "admin" {
		t.Fatalf("user was not updated: %+v", u)
	}
	if !CheckPassword(u.Password, "newpass") {
		t.Fatal("new password does not match stored hash")
	}
	if CheckPassword(u.Password, "oldpass") {
		t.Fatal("old password still matches stored hash")
	}
	if err := s.UpdateUser(9999, "missing_update", "user"); !errors.Is(err, errs.ErrNotFound) {
		t.Fatalf("expected ErrNotFound updating missing user, got %v", err)
	}
	if err := s.UpdateUserPassword(9999, "newpass"); !errors.Is(err, errs.ErrNotFound) {
		t.Fatalf("expected ErrNotFound updating missing password, got %v", err)
	}
}

func TestUpdateUsernameConflictAndMissingUser(t *testing.T) {
	s := newTestStore(t)

	firstID, err := s.CreateUser("first_user", "pass", "user")
	if err != nil {
		t.Fatalf("CreateUser first error: %v", err)
	}
	secondID, err := s.CreateUser("second_user", "pass", "user")
	if err != nil {
		t.Fatalf("CreateUser second error: %v", err)
	}

	if err := s.UpdateUsername(firstID, "third_user"); err != nil {
		t.Fatalf("UpdateUsername error: %v", err)
	}
	if err := s.UpdateUsername(secondID, "third_user"); err == nil {
		t.Fatal("expected username conflict error")
	}
	if err := s.UpdateUsername(9999, "missing_user"); !errors.Is(err, errs.ErrNotFound) {
		t.Fatalf("expected ErrNotFound for missing user, got %v", err)
	}
}

func TestCountAdminUsersAndAvatar(t *testing.T) {
	s := newTestStore(t)

	adminID, err := s.CreateUser("avatar_admin", "pass", "admin")
	if err != nil {
		t.Fatalf("CreateUser admin error: %v", err)
	}
	if _, err := s.CreateUser("avatar_user", "pass", "user"); err != nil {
		t.Fatalf("CreateUser user error: %v", err)
	}

	count, err := s.CountAdminUsers()
	if err != nil {
		t.Fatalf("CountAdminUsers error: %v", err)
	}
	if count != 1 {
		t.Fatalf("admin count = %d, want 1", count)
	}

	const avatar = "data:image/png;base64,aGVsbG8="
	if err := s.UpdateAvatar(adminID, avatar); err != nil {
		t.Fatalf("UpdateAvatar error: %v", err)
	}
	got, err := s.GetAvatar("avatar_admin")
	if err != nil {
		t.Fatalf("GetAvatar error: %v", err)
	}
	if got != avatar {
		t.Fatalf("avatar = %q, want %q", got, avatar)
	}
	if err := s.DeleteAvatar(adminID); err != nil {
		t.Fatalf("DeleteAvatar error: %v", err)
	}
	got, err = s.GetAvatar("avatar_admin")
	if err != nil {
		t.Fatalf("GetAvatar after delete error: %v", err)
	}
	if got != "" {
		t.Fatalf("avatar after delete = %q, want empty", got)
	}
	got, err = s.GetAvatar("missing_avatar_user")
	if err != nil {
		t.Fatalf("GetAvatar missing user error: %v", err)
	}
	if got != "" {
		t.Fatalf("missing avatar = %q, want empty", got)
	}
	if err := s.UpdateAvatar(9999, avatar); !errors.Is(err, errs.ErrNotFound) {
		t.Fatalf("expected ErrNotFound updating missing avatar, got %v", err)
	}
	if err := s.DeleteAvatar(9999); !errors.Is(err, errs.ErrNotFound) {
		t.Fatalf("expected ErrNotFound deleting missing avatar, got %v", err)
	}
}

func TestUpdateUserFull(t *testing.T) {
	s := newTestStore(t)

	id, err := s.CreateUser("full_before", "oldpass", "user")
	if err != nil {
		t.Fatalf("CreateUser error: %v", err)
	}
	if err := s.UpdateUserFull(id, "full_after", "admin", "newpass"); err != nil {
		t.Fatalf("UpdateUserFull error: %v", err)
	}

	u, err := s.GetUserByID(id)
	if err != nil {
		t.Fatalf("GetUserByID error: %v", err)
	}
	if u.Username != "full_after" || u.Role != "admin" {
		t.Fatalf("user was not fully updated: %+v", u)
	}
	if !CheckPassword(u.Password, "newpass") {
		t.Fatal("updated password does not match")
	}
	if err := s.UpdateUserFull(9999, "missing_full", "user", ""); !errors.Is(err, errs.ErrNotFound) {
		t.Fatalf("expected ErrNotFound for missing user, got %v", err)
	}
	otherID, err := s.CreateUser("full_other", "pass", "user")
	if err != nil {
		t.Fatalf("CreateUser other error: %v", err)
	}
	if err := s.UpdateUserFull(otherID, "full_after", "user", ""); !errors.Is(err, errs.ErrUsernameTaken) {
		t.Fatalf("expected ErrUsernameTaken for duplicate username, got %v", err)
	}
}
