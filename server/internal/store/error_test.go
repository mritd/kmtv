package store

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/mritd/kmtv/internal/consts"
	"github.com/mritd/kmtv/internal/model"
)

func TestNewStoreInvalidPath(t *testing.T) {
	_, err := New(filepath.Join(t.TempDir(), "missing", "kmtv.db"))
	if err == nil {
		t.Fatal("expected New to fail for missing parent directory")
	}
}

func TestStoreMethodsReturnErrorsAfterClose(t *testing.T) {
	s := newTestStore(t)
	if err := s.Close(); err != nil {
		t.Fatalf("Close error: %v", err)
	}

	source := &model.Source{Key: "closed.example", Name: "Closed", API: "https://closed.example/api"}
	if _, err := s.CreateSource(source); err == nil {
		t.Fatal("expected CreateSource error after close")
	}
	if _, err := s.GetSourceByID(1); err == nil {
		t.Fatal("expected GetSourceByID error after close")
	}
	if _, err := s.GetSourceByKey("closed.example"); err == nil {
		t.Fatal("expected GetSourceByKey error after close")
	}
	if _, err := s.ListSources(); err == nil {
		t.Fatal("expected ListSources error after close")
	}
	if _, err := s.ListEnabledHealthySources(); err == nil {
		t.Fatal("expected ListEnabledHealthySources error after close")
	}
	if _, err := s.ListEnabledSources(); err == nil {
		t.Fatal("expected ListEnabledSources error after close")
	}
	if err := s.UpdateSource(1, "name", "https://closed.example/api", "", "", true); err == nil {
		t.Fatal("expected UpdateSource error after close")
	}
	if err := s.UpdateSourceHealth(1, consts.HealthHealthy); err == nil {
		t.Fatal("expected UpdateSourceHealth error after close")
	}
	if err := s.UpdateSourceSearchable(1, false); err == nil {
		t.Fatal("expected UpdateSourceSearchable error after close")
	}
	if err := s.DeleteSource(1); err == nil {
		t.Fatal("expected DeleteSource error after close")
	}
	if err := s.UpsertSourceByKey(source); err == nil {
		t.Fatal("expected UpsertSourceByKey error after close")
	}

	if _, err := s.CreateSubscription("https://closed.example/config.json", true, 60); err == nil {
		t.Fatal("expected CreateSubscription error after close")
	}
	if _, err := s.GetSubscriptionByID(1); err == nil {
		t.Fatal("expected GetSubscriptionByID error after close")
	}
	if _, err := s.ListSubscriptions(); err == nil {
		t.Fatal("expected ListSubscriptions error after close")
	}
	if err := s.UpdateSubscription(1, "https://closed.example/config.json", true, 60); err == nil {
		t.Fatal("expected UpdateSubscription error after close")
	}
	if err := s.UpdateSubscriptionLastSync(1); err == nil {
		t.Fatal("expected UpdateSubscriptionLastSync error after close")
	}
	if err := s.DeleteSubscription(1); err == nil {
		t.Fatal("expected DeleteSubscription error after close")
	}

	if _, err := s.CreateUser("closed_user", "password", "user"); err == nil {
		t.Fatal("expected CreateUser error after close")
	}
	if _, err := s.GetUserByID(1); err == nil {
		t.Fatal("expected GetUserByID error after close")
	}
	if _, err := s.GetUserByUsername("closed_user"); err == nil {
		t.Fatal("expected GetUserByUsername error after close")
	}
	if _, err := s.ListUsers(); err == nil {
		t.Fatal("expected ListUsers error after close")
	}
	if err := s.UpdateUser(1, "closed_user", "user"); err == nil {
		t.Fatal("expected UpdateUser error after close")
	}
	if err := s.UpdateUserPassword(1, "password"); err == nil {
		t.Fatal("expected UpdateUserPassword error after close")
	}
	if err := s.UpdateUsername(1, "closed_user"); err == nil {
		t.Fatal("expected UpdateUsername error after close")
	}
	if _, err := s.CountAdminUsers(); err == nil {
		t.Fatal("expected CountAdminUsers error after close")
	}
	if err := s.DeleteUser(1); err == nil {
		t.Fatal("expected DeleteUser error after close")
	}
	if err := s.UpdateUserFull(1, "closed_user", "user", "password"); err == nil {
		t.Fatal("expected UpdateUserFull error after close")
	}
	if err := s.UpdateAvatar(1, "data:image/png;base64,aa=="); err == nil {
		t.Fatal("expected UpdateAvatar error after close")
	}
	if _, err := s.GetAvatar("closed_user"); err == nil {
		t.Fatal("expected GetAvatar error after close")
	}
	if err := s.DeleteAvatar(1); err == nil {
		t.Fatal("expected DeleteAvatar error after close")
	}

	if _, err := s.GetSetting("site_name"); err == nil {
		t.Fatal("expected GetSetting error after close")
	}
	if err := s.SetSetting("site_name", "closed"); err == nil {
		t.Fatal("expected SetSetting error after close")
	}
	if _, err := s.GetAllSettings(); err == nil {
		t.Fatal("expected GetAllSettings error after close")
	}

	if _, err := s.CreateAuthSession(1, "closed-auth", time.Now().Add(time.Hour), "", ""); err == nil {
		t.Fatal("expected CreateAuthSession error after close")
	}
	if _, _, err := s.GetValidAuthSessionByHash("closed-auth"); err == nil {
		t.Fatal("expected GetValidAuthSessionByHash error after close")
	}
	if err := s.RevokeAuthSessionByHash("closed-auth"); err == nil {
		t.Fatal("expected RevokeAuthSessionByHash error after close")
	}
	if err := s.RevokeAuthSessionsByUser(1); err == nil {
		t.Fatal("expected RevokeAuthSessionsByUser error after close")
	}
	if err := s.TouchAuthSession(1); err == nil {
		t.Fatal("expected TouchAuthSession error after close")
	}
	if _, err := s.CreateMediaToken("closed-media", 0, "segment", "url", "", time.Now().Add(time.Hour)); err == nil {
		t.Fatal("expected CreateMediaToken error after close")
	}
	if _, err := s.GetValidMediaToken("closed-media", "segment", "url"); err == nil {
		t.Fatal("expected GetValidMediaToken error after close")
	}
	if err := s.TouchMediaToken(1); err == nil {
		t.Fatal("expected TouchMediaToken error after close")
	}
	if err := s.DeleteExpiredTokens(); err == nil {
		t.Fatal("expected DeleteExpiredTokens error after close")
	}
}
