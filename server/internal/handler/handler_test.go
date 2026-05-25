package handler

import (
	"bytes"
	"embed"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/mritd/kmtv/internal/middleware"
	"github.com/mritd/kmtv/internal/service"
	"github.com/mritd/kmtv/internal/store"
)

//go:embed testdata/static/*
var testFrontendFS embed.FS

func TestMain(m *testing.M) {
	gin.SetMode(gin.TestMode)
	os.Exit(m.Run())
}

// setupTestHandler creates a Handler backed by an in-memory SQLite store
// and a gin.Engine with all routes registered.
func setupTestHandler(t *testing.T) (*Handler, *gin.Engine) {
	t.Helper()

	s, err := store.New(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })

	middleware.ResetAnonAccessCache()

	authSvc := service.NewAuthService(s)
	mediaSvc := service.NewMediaTokenService(s)
	proxySvc := service.NewProxyService()
	searchSvc := service.NewSearchService(s, proxySvc)
	sourceSvc := service.NewSourceService(s)
	doubanSvc := service.NewDoubanService(s)

	h := New(s, authSvc, mediaSvc, searchSvc, proxySvc, sourceSvc, doubanSvc)
	r := gin.New()
	h.RegisterRoutes(r)
	return h, r
}

// createTestUser creates a user via the store and returns its ID.
func createTestUser(t *testing.T, h *Handler, username, password, role string) int64 {
	t.Helper()
	id, err := h.store.CreateUser(username, password, role)
	if err != nil {
		t.Fatalf("create test user %q: %v", username, err)
	}
	return id
}

// disableAnonymousAccess sets anonymous_access to "false" so that Auth requires a valid bearer token.
// disableAnonymousAccess 将 anonymous_access 设为 "false", 使 Auth 要求有效 bearer token.
func disableAnonymousAccess(t *testing.T, h *Handler) {
	t.Helper()
	if err := h.store.SetSetting("anonymous_access", "false"); err != nil {
		t.Fatalf("disable anonymous access: %v", err)
	}
}

// adminBearer returns a bearer auth header for the given admin username.
// adminBearer 为指定 admin 用户返回 bearer 认证 header.
func adminBearer(t *testing.T, h *Handler, username string) string {
	t.Helper()
	user, err := h.store.GetUserByUsername(username)
	if err != nil || user == nil {
		t.Fatalf("adminBearer user lookup %q: %v", username, err)
	}
	issued, err := h.authSvc.IssueAccessToken(user, time.Hour, "test", "127.0.0.1")
	if err != nil {
		t.Fatalf("IssueAccessToken: %v", err)
	}
	return "Bearer " + issued.Token
}

// decodeJSON decodes the response body into a map.
func decodeJSON(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&m); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
	return m
}

// loginAndGetBearer performs an HTTP login and returns the bearer auth header.
// loginAndGetBearer 执行登录请求并返回 bearer 认证 header.
func loginAndGetBearer(t *testing.T, r *gin.Engine, username, password string) string {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"username": username, "password": password})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("login failed: %d %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode login response: %v", err)
	}
	token, ok := resp["access_token"].(string)
	if !ok || token == "" {
		t.Fatalf("missing access_token in response: %+v", resp)
	}
	return "Bearer " + token
}

// ---------- Auth handler tests ----------
