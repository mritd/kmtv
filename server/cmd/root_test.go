package cmd

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/sirupsen/logrus"

	"github.com/mritd/kmtv/internal/consts"
	"github.com/mritd/kmtv/internal/service"
	"github.com/mritd/kmtv/internal/store"
)

func TestSeedSourcesFromURL(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"cache_time": 3600,
			"api_site": {
				"cmd-seed.example": {
					"name": "Cmd Seed",
					"api": "https://cmd-seed.example/api.php",
					"detail": "https://cmd-seed.example"
				}
			}
		}`))
	}))
	defer upstream.Close()

	s, err := store.New(filepath.Join(t.TempDir(), "cmd-seed.db"))
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	sourceSvc := service.NewSourceServiceWithClient(s, upstream.Client())
	seedSourcesFromURL(s, sourceSvc, upstream.URL, upstream.Client())

	src, err := s.GetSourceByKey("cmd-seed.example")
	if err != nil {
		t.Fatalf("GetSourceByKey error: %v", err)
	}
	if src == nil || src.Name != "Cmd Seed" {
		t.Fatalf("source was not seeded: %+v", src)
	}
	subs, err := s.ListSubscriptions()
	if err != nil {
		t.Fatalf("ListSubscriptions error: %v", err)
	}
	if len(subs) != 1 || subs[0].URL != upstream.URL || !subs[0].AutoUpdate || subs[0].Interval != 86400 {
		t.Fatalf("subscription was not created like default seed behavior: %+v", subs)
	}
}

func TestPrepareServerCreatesDefaultAdminAndRoutes(t *testing.T) {
	t.Setenv(consts.EnvInitSourceURL, "")

	dbFile := filepath.Join(t.TempDir(), "prepare-server.db")
	s, cleanup, r, err := prepareServer(dbFile, FrontendFS)
	if err != nil {
		t.Fatalf("prepareServer error: %v", err)
	}
	t.Cleanup(cleanup)

	admin, err := s.GetUserByUsername("admin")
	if err != nil {
		t.Fatalf("GetUserByUsername admin: %v", err)
	}
	if admin == nil || admin.Role != "admin" {
		t.Fatalf("default admin was not created: %+v", admin)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected auth/me route to be registered, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPrepareServerLogsVersionWithoutDuplicatePrefix(t *testing.T) {
	t.Setenv(consts.EnvInitSourceURL, "")
	var logs bytes.Buffer
	oldOutput := logrus.StandardLogger().Out
	logrus.SetOutput(&logs)
	t.Cleanup(func() { logrus.SetOutput(oldOutput) })

	s, cleanup, _, err := prepareServer(filepath.Join(t.TempDir(), "prepare-version-log.db"), FrontendFS)
	if err != nil {
		t.Fatalf("prepareServer error: %v", err)
	}
	t.Cleanup(cleanup)
	if s == nil {
		t.Fatal("expected store")
	}

	got := logs.String()
	if strings.Contains(got, "KMTV vv0.0.0-dev starting") {
		t.Fatalf("startup log contains duplicate version prefix: %s", got)
	}
	if !strings.Contains(got, "KMTV v0.0.0-dev starting") {
		t.Fatalf("startup log missing expected version: %s", got)
	}
}

func TestPrepareServerUsesExistingAdminAndReportsStoreErrors(t *testing.T) {
	t.Setenv(consts.EnvInitSourceURL, "")

	dbFile := filepath.Join(t.TempDir(), "prepare-existing-admin.db")
	initial, err := store.New(dbFile)
	if err != nil {
		t.Fatalf("create initial store: %v", err)
	}
	if _, err := initial.CreateUser("admin", "changed", "admin"); err != nil {
		t.Fatalf("create existing admin: %v", err)
	}
	if err := initial.Close(); err != nil {
		t.Fatalf("close initial store: %v", err)
	}

	s, cleanup, _, err := prepareServer(dbFile, FrontendFS)
	if err != nil {
		t.Fatalf("prepareServer with existing admin error: %v", err)
	}
	t.Cleanup(cleanup)
	admin, err := s.GetUserByUsername("admin")
	if err != nil {
		t.Fatalf("GetUserByUsername admin: %v", err)
	}
	if admin == nil || !store.CheckPassword(admin.Password, "changed") {
		t.Fatalf("existing admin was unexpectedly replaced: %+v", admin)
	}

	_, cleanup, _, err = prepareServer(filepath.Join(t.TempDir(), "missing", "kmtv.db"), FrontendFS)
	if err == nil {
		if cleanup != nil {
			cleanup()
		}
		t.Fatal("expected prepareServer to report store initialization error")
	}
}

func TestSeedInitialSourcesFromEnvWithClient(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"cache_time": 3600,
			"api_site": {
				"env-seed.example": {
					"name": "Env Seed",
					"api": "https://env-seed.example/api.php",
					"detail": "https://env-seed.example"
				}
			}
		}`))
	}))
	defer upstream.Close()

	t.Setenv(consts.EnvInitSourceURL, upstream.URL)

	s, err := store.New(filepath.Join(t.TempDir(), "cmd-env-seed.db"))
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	sourceSvc := service.NewSourceServiceWithClient(s, upstream.Client())
	seedInitialSourcesFromEnvWithClient(s, sourceSvc, upstream.Client())

	src, err := s.GetSourceByKey("env-seed.example")
	if err != nil {
		t.Fatalf("GetSourceByKey error: %v", err)
	}
	if src == nil || src.Name != "Env Seed" {
		t.Fatalf("source was not seeded from env: %+v", src)
	}
	subs, err := s.ListSubscriptions()
	if err != nil {
		t.Fatalf("ListSubscriptions error: %v", err)
	}
	if len(subs) != 1 || subs[0].URL != upstream.URL || !subs[0].AutoUpdate || subs[0].Interval != 86400 {
		t.Fatalf("env seed should create default-style subscription: %+v", subs)
	}
}

func TestSeedInitialSourcesFromEnvWithClientSkipsWhenUnset(t *testing.T) {
	t.Setenv(consts.EnvInitSourceURL, "")

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("initial source config URL should not be fetched when env is unset")
	}))
	defer upstream.Close()

	s, err := store.New(filepath.Join(t.TempDir(), "cmd-env-empty.db"))
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	sourceSvc := service.NewSourceServiceWithClient(s, upstream.Client())
	seedInitialSourcesFromEnvWithClient(s, sourceSvc, upstream.Client())

	sources, err := s.ListSources()
	if err != nil {
		t.Fatalf("ListSources error: %v", err)
	}
	if len(sources) != 0 {
		t.Fatalf("expected no sources when env is unset, got %+v", sources)
	}
	subs, err := s.ListSubscriptions()
	if err != nil {
		t.Fatalf("ListSubscriptions error: %v", err)
	}
	if len(subs) != 0 {
		t.Fatalf("expected no subscriptions when env is unset, got %+v", subs)
	}
}

func TestSeedInitialSourcesFromEnvSkipsWhenUnset(t *testing.T) {
	t.Setenv(consts.EnvInitSourceURL, "")

	s, err := store.New(filepath.Join(t.TempDir(), "cmd-env-wrapper-empty.db"))
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	sourceSvc := service.NewSourceServiceWithClient(s, http.DefaultClient)
	seedInitialSourcesFromEnv(s, sourceSvc)

	sources, err := s.ListSources()
	if err != nil {
		t.Fatalf("ListSources error: %v", err)
	}
	if len(sources) != 0 {
		t.Fatalf("expected wrapper to skip unset env, got sources %+v", sources)
	}
}

func TestSeedSourcesFromURLSkipsBadResponses(t *testing.T) {
	tests := []struct {
		name   string
		status int
		body   string
	}{
		{name: "bad status", status: http.StatusForbidden, body: "blocked"},
		{name: "invalid config", status: http.StatusOK, body: `{"api_site":`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tt.status)
				_, _ = w.Write([]byte(tt.body))
			}))
			defer upstream.Close()

			s, err := store.New(filepath.Join(t.TempDir(), "cmd-seed-error.db"))
			if err != nil {
				t.Fatalf("create store: %v", err)
			}
			t.Cleanup(func() { _ = s.Close() })

			sourceSvc := service.NewSourceServiceWithClient(s, upstream.Client())
			seedSourcesFromURL(s, sourceSvc, upstream.URL, upstream.Client())

			sources, err := s.ListSources()
			if err != nil {
				t.Fatalf("ListSources error: %v", err)
			}
			if len(sources) != 0 {
				t.Fatalf("expected no sources after bad seed response, got %+v", sources)
			}
		})
	}
}

func TestSeedSourcesFromURLSkipsInvalidURL(t *testing.T) {
	s, err := store.New(filepath.Join(t.TempDir(), "cmd-seed-invalid-url.db"))
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	sourceSvc := service.NewSourceServiceWithClient(s, http.DefaultClient)
	seedSourcesFromURL(s, sourceSvc, "http:///missing-host", http.DefaultClient)

	sources, err := s.ListSources()
	if err != nil {
		t.Fatalf("ListSources error: %v", err)
	}
	if len(sources) != 0 {
		t.Fatalf("expected no sources after invalid seed URL, got %+v", sources)
	}
}

func TestExecuteHelp(t *testing.T) {
	rootCmd.SetArgs([]string{"--help"})
	rootCmd.SetOut(io.Discard)
	rootCmd.SetErr(io.Discard)
	t.Cleanup(func() {
		rootCmd.SetArgs(nil)
		rootCmd.SetOut(nil)
		rootCmd.SetErr(nil)
	})

	Execute()
}
