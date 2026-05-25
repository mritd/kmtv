package service

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/mritd/kmtv/internal/consts"
	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
	"github.com/mritd/kmtv/internal/store"
)

func newSourceServiceTestStore(t *testing.T) *store.Store {
	t.Helper()
	s, err := store.New(filepath.Join(t.TempDir(), "source-service.db"))
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestBuildHealthCheckURL(t *testing.T) {
	tests := []struct {
		name string
		api  string
		want string
	}{
		{
			name: "plain api",
			api:  "https://source.example/api.php/provide/vod",
			want: "https://source.example/api.php/provide/vod?ac=videolist&pg=1",
		},
		{
			name: "api with query",
			api:  "https://source.example/api.php/provide/vod?token=abc",
			want: "https://source.example/api.php/provide/vod?token=abc&ac=videolist&pg=1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := buildHealthCheckURL(tt.api); got != tt.want {
				t.Fatalf("buildHealthCheckURL() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestSourceServiceCheckSingleSource(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("ac") != "videolist" || r.URL.Query().Get("pg") != "1" {
			t.Fatalf("unexpected health check query: %s", r.URL.RawQuery)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	s := newSourceServiceTestStore(t)
	id, err := s.CreateSource(&model.Source{
		Key:     "healthy.example",
		Name:    "Healthy",
		API:     upstream.URL + "/api.php/provide/vod",
		Enabled: true,
	})
	if err != nil {
		t.Fatalf("CreateSource error: %v", err)
	}

	ss := NewSourceService(s)
	ss.client = upstream.Client()
	health, err := ss.CheckSingleSource(id)
	if err != nil {
		t.Fatalf("CheckSingleSource error: %v", err)
	}
	if health != consts.HealthHealthy {
		t.Fatalf("health = %q, want %q", health, consts.HealthHealthy)
	}
	got, err := s.GetSourceByID(id)
	if err != nil {
		t.Fatalf("GetSourceByID error: %v", err)
	}
	if got.Health != consts.HealthHealthy || got.LastCheck.IsZero() {
		t.Fatalf("source health was not persisted: %+v", got)
	}
}

func TestSourceServiceCheckSingleSourceErrors(t *testing.T) {
	s := newSourceServiceTestStore(t)
	ss := NewSourceServiceWithClient(s, http.DefaultClient)

	if _, err := ss.CheckSingleSource(9999); err == nil {
		t.Fatal("expected missing source error")
	}

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer upstream.Close()

	id, err := s.CreateSource(&model.Source{
		Key:     "bad-status.example",
		Name:    "Bad Status",
		API:     upstream.URL + "/api.php",
		Enabled: true,
	})
	if err != nil {
		t.Fatalf("CreateSource error: %v", err)
	}
	ss = NewSourceServiceWithClient(s, upstream.Client())
	health, err := ss.CheckSingleSource(id)
	if err != nil {
		t.Fatalf("CheckSingleSource bad status error: %v", err)
	}
	if health != consts.HealthUnhealthy {
		t.Fatalf("health = %q, want unhealthy", health)
	}
}

func TestSourceServiceRunHealthCheckUpdatesAllEnabledSources(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Query().Get("source") {
		case "healthy":
			w.WriteHeader(http.StatusOK)
		case "unhealthy":
			w.WriteHeader(http.StatusInternalServerError)
		default:
			t.Fatalf("unexpected source query: %s", r.URL.RawQuery)
		}
	}))
	defer upstream.Close()

	s := newSourceServiceTestStore(t)
	healthyID, err := s.CreateSource(&model.Source{
		Key:     "healthy-source.example",
		Name:    "Healthy",
		API:     upstream.URL + "/api.php?source=healthy",
		Enabled: true,
	})
	if err != nil {
		t.Fatalf("CreateSource healthy error: %v", err)
	}
	unhealthyID, err := s.CreateSource(&model.Source{
		Key:     "unhealthy-source.example",
		Name:    "Unhealthy",
		API:     upstream.URL + "/api.php?source=unhealthy",
		Enabled: true,
	})
	if err != nil {
		t.Fatalf("CreateSource unhealthy error: %v", err)
	}

	ss := NewSourceServiceWithClient(s, upstream.Client())
	ss.RunHealthCheck()

	healthy, err := s.GetSourceByID(healthyID)
	if err != nil {
		t.Fatalf("GetSourceByID healthy error: %v", err)
	}
	if healthy.Health != consts.HealthHealthy {
		t.Fatalf("healthy source health = %q", healthy.Health)
	}
	unhealthy, err := s.GetSourceByID(unhealthyID)
	if err != nil {
		t.Fatalf("GetSourceByID unhealthy error: %v", err)
	}
	if unhealthy.Health != consts.HealthUnhealthy {
		t.Fatalf("unhealthy source health = %q", unhealthy.Health)
	}
}

func TestSourceServiceStartAndCronManagement(t *testing.T) {
	s := newSourceServiceTestStore(t)
	if err := s.SetSetting("health_check_interval", "60"); err != nil {
		t.Fatalf("SetSetting error: %v", err)
	}
	subID, err := s.CreateSubscription("https://example.com/config.json", true, 60)
	if err != nil {
		t.Fatalf("CreateSubscription error: %v", err)
	}

	ss := NewSourceServiceWithClient(s, http.DefaultClient)
	if err := ss.Start(); err != nil {
		t.Fatalf("Start error: %v", err)
	}
	t.Cleanup(ss.Stop)

	if _, ok := ss.subCrons[subID]; !ok {
		t.Fatalf("expected subscription cron for %d", subID)
	}
	ss.UpdateSubCron(subID, false, 60)
	if _, ok := ss.subCrons[subID]; ok {
		t.Fatalf("expected subscription cron to be removed")
	}
	ss.UpdateSubCron(subID, true, 120)
	if _, ok := ss.subCrons[subID]; !ok {
		t.Fatalf("expected subscription cron to be added again")
	}
	ss.RemoveSubCron(subID)
	if _, ok := ss.subCrons[subID]; ok {
		t.Fatalf("expected subscription cron to be removed by RemoveSubCron")
	}
}

func TestSourceServiceStartUsesDefaultIntervalForInvalidSetting(t *testing.T) {
	s := newSourceServiceTestStore(t)
	if err := s.SetSetting(consts.SettingHealthCheckInterval, "not-a-number"); err != nil {
		t.Fatalf("SetSetting error: %v", err)
	}
	if _, err := s.CreateSubscription("https://example.com/manual.json", false, 60); err != nil {
		t.Fatalf("CreateSubscription manual: %v", err)
	}

	ss := NewSourceServiceWithClient(s, http.DefaultClient)
	if err := ss.Start(); err != nil {
		t.Fatalf("Start error: %v", err)
	}
	t.Cleanup(ss.Stop)
	if len(ss.subCrons) != 0 {
		t.Fatalf("manual subscription should not create cron: %#v", ss.subCrons)
	}
}

func TestSourceServiceRollbackSubCronsRemovesEntries(t *testing.T) {
	s := newSourceServiceTestStore(t)
	ss := NewSourceServiceWithClient(s, http.DefaultClient)

	if err := ss.addSubCron(11, 60); err != nil {
		t.Fatalf("addSubCron first: %v", err)
	}
	if err := ss.addSubCron(22, 120); err != nil {
		t.Fatalf("addSubCron second: %v", err)
	}
	if len(ss.subCrons) != 2 {
		t.Fatalf("subCrons before rollback = %#v", ss.subCrons)
	}

	ss.rollbackSubCrons()
	if len(ss.subCrons) != 0 {
		t.Fatalf("subCrons after rollback = %#v", ss.subCrons)
	}
}

func TestSourceServiceStopCancelsHealthCheckContext(t *testing.T) {
	s := newSourceServiceTestStore(t)
	ss := NewSourceServiceWithClient(s, http.DefaultClient)

	ss.Stop()
	select {
	case <-ss.ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("Stop should cancel the source service context")
	}
}

func TestSourceServiceRunHealthCheckMarksInvalidURLUnhealthy(t *testing.T) {
	s := newSourceServiceTestStore(t)
	id, err := s.CreateSource(&model.Source{
		Key:     "invalid-url.example",
		Name:    "Invalid URL",
		API:     "://bad",
		Enabled: true,
	})
	if err != nil {
		t.Fatalf("CreateSource invalid URL: %v", err)
	}

	ss := NewSourceServiceWithClient(s, http.DefaultClient)
	ss.RunHealthCheck()

	got, err := s.GetSourceByID(id)
	if err != nil {
		t.Fatalf("GetSourceByID: %v", err)
	}
	if got.Health != consts.HealthUnhealthy {
		t.Fatalf("health = %q, want %q", got.Health, consts.HealthUnhealthy)
	}
}

func TestSourceServiceRunHealthCheckSkipsConcurrentRun(t *testing.T) {
	s := newSourceServiceTestStore(t)
	ss := NewSourceServiceWithClient(s, http.DefaultClient)
	ss.healthRunning.Store(true)
	defer ss.healthRunning.Store(false)

	ss.RunHealthCheck()
}

func TestSourceServiceRunHealthCheckHandlesClosedStore(t *testing.T) {
	s := newSourceServiceTestStore(t)
	ss := NewSourceServiceWithClient(s, http.DefaultClient)
	if err := s.Close(); err != nil {
		t.Fatalf("Close store: %v", err)
	}

	ss.RunHealthCheck()
}

func TestSourceServiceAddSubCronRejectsInvalidInterval(t *testing.T) {
	s := newSourceServiceTestStore(t)
	ss := NewSourceServiceWithClient(s, http.DefaultClient)

	if err := ss.addSubCron(1, -1); err == nil {
		t.Fatal("expected invalid interval error")
	}
	if len(ss.subCrons) != 0 {
		t.Fatalf("subCrons = %#v, want empty after failed add", ss.subCrons)
	}
}

func TestSourceServiceConstructorAndCronErrors(t *testing.T) {
	s := newSourceServiceTestStore(t)
	ss := NewSourceServiceWithClient(s, nil)
	if ss.client == nil {
		t.Fatal("expected fallback source service client")
	}

	if err := s.Close(); err != nil {
		t.Fatalf("Close store: %v", err)
	}
	if err := ss.Start(); err == nil {
		t.Fatal("expected Start error after store close")
	}
}

func TestSourceServiceLifecycleIsOneShot(t *testing.T) {
	s := newSourceServiceTestStore(t)
	ss := NewSourceServiceWithClient(s, http.DefaultClient)
	if err := ss.Start(); err != nil {
		t.Fatalf("Start error: %v", err)
	}
	if err := ss.Start(); !errors.Is(err, errs.ErrServiceAlreadyStarted) {
		t.Fatalf("second Start error = %v, want ErrServiceAlreadyStarted", err)
	}
	ss.Stop()
	if err := ss.Start(); !errors.Is(err, errs.ErrServiceStopped) {
		t.Fatalf("Start after Stop error = %v, want ErrServiceStopped", err)
	}
}

func TestSourceServiceSyncSubscriptionImportsRealConfig(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/source-config.json" {
			t.Fatalf("unexpected subscription path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{
			"cache_time": 3600,
			"api_site": {
				"alpha.example": {
					"name": "Alpha",
					"api": "https://alpha.example/api.php/provide/vod",
					"detail": "https://alpha.example",
					"_comment": "primary"
				},
				"beta.example": {
					"name": "Beta",
					"api": "https://beta.example/api.php/provide/vod",
					"detail": "https://beta.example",
					"_comment": "backup"
				}
			}
		}`)
	}))
	defer upstream.Close()

	s := newSourceServiceTestStore(t)
	subID, err := s.CreateSubscription(upstream.URL+"/source-config.json", true, 3600)
	if err != nil {
		t.Fatalf("CreateSubscription error: %v", err)
	}

	ss := NewSourceService(s)
	ss.client = upstream.Client()
	if err := ss.SyncSubscription(subID); err != nil {
		t.Fatalf("SyncSubscription error: %v", err)
	}

	sources, err := s.ListSources()
	if err != nil {
		t.Fatalf("ListSources error: %v", err)
	}
	if len(sources) != 2 {
		t.Fatalf("source count = %d, want 2", len(sources))
	}
	if sources[0].Key != "alpha.example" || sources[1].Key != "beta.example" {
		t.Fatalf("sources not imported in deterministic order: %+v", sources)
	}
	sub, err := s.GetSubscriptionByID(subID)
	if err != nil {
		t.Fatalf("GetSubscriptionByID error: %v", err)
	}
	if sub.LastSync.IsZero() {
		t.Fatal("expected subscription last_sync to be set")
	}
}

func TestSourceServiceSyncSubscriptionErrors(t *testing.T) {
	s := newSourceServiceTestStore(t)
	ss := NewSourceServiceWithClient(s, http.DefaultClient)
	if err := ss.SyncSubscription(9999); err == nil {
		t.Fatal("expected missing subscription error")
	}

	badURLID, err := s.CreateSubscription("://bad", false, 3600)
	if err != nil {
		t.Fatalf("CreateSubscription bad URL error: %v", err)
	}
	if err := ss.SyncSubscription(badURLID); err == nil {
		t.Fatal("expected bad subscription URL error")
	}

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

			subID, err := s.CreateSubscription(upstream.URL+"/config.json", false, 3600)
			if err != nil {
				t.Fatalf("CreateSubscription error: %v", err)
			}
			ss := NewSourceServiceWithClient(s, upstream.Client())
			if err := ss.SyncSubscription(subID); err == nil {
				t.Fatal("expected sync subscription error")
			}
		})
	}
}

func TestSourceServiceImportConfigRejectsInvalidJSON(t *testing.T) {
	s := newSourceServiceTestStore(t)
	ss := NewSourceService(s)

	if _, err := ss.ImportConfig([]byte(`{"api_site":`)); err == nil {
		t.Fatal("expected invalid config error")
	}
}
