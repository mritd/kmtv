package middleware

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
	"github.com/mritd/kmtv/internal/store"
)

func TestMain(m *testing.M) {
	gin.SetMode(gin.TestMode)
	os.Exit(m.Run())
}

type stubAuthVerifier struct {
	session *model.AuthSession
	user    *model.User
	err     error
}

func (s stubAuthVerifier) VerifyAccessToken(token string) (*model.AuthSession, *model.User, error) {
	if token != "valid-token" {
		return nil, nil, nil
	}
	return s.session, s.user, s.err
}

// newTestStore creates an in-memory store for middleware tests.
// newTestStore 为 middleware 测试创建内存 store.
func newTestStore(t *testing.T) *store.Store {
	t.Helper()
	s, err := store.New(":memory:")
	if err != nil {
		t.Fatalf("create test store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

// performRequest executes a request against a gin engine.
// performRequest 对 gin engine 执行一次请求.
func performRequest(r *gin.Engine, method, path, bearer string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func validVerifier() stubAuthVerifier {
	return stubAuthVerifier{
		session: &model.AuthSession{ID: 100, UserID: 1, ExpiresAt: time.Now().Add(time.Hour)},
		user:    &model.User{ID: 1, Username: "testuser", Role: "admin"},
	}
}

func TestAuth_AnonymousAccess(t *testing.T) {
	s := newTestStore(t)
	ResetAnonAccessCache()
	if err := s.SetSetting("anonymous_access", "true"); err != nil {
		t.Fatal(err)
	}

	var ctxUsername, ctxRole string
	r := gin.New()
	r.Use(Auth(s, nil))
	r.GET("/test", func(c *gin.Context) {
		if v, ok := c.Get("username"); ok {
			ctxUsername, _ = v.(string)
		}
		if v, ok := c.Get("role"); ok {
			ctxRole, _ = v.(string)
		}
		c.Status(http.StatusOK)
	})

	w := performRequest(r, http.MethodGet, "/test", "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if ctxUsername != "anonymous" {
		t.Errorf("expected username=%q, got %q", "anonymous", ctxUsername)
	}
	if ctxRole != "user" {
		t.Errorf("expected role=%q, got %q", "user", ctxRole)
	}
}

func TestAuth_ValidBearer(t *testing.T) {
	s := newTestStore(t)
	ResetAnonAccessCache()
	if err := s.SetSetting("anonymous_access", "false"); err != nil {
		t.Fatal(err)
	}

	var ctxUsername, ctxRole string
	var ctxSession *model.AuthSession
	var ctxUser *model.User
	r := gin.New()
	r.Use(Auth(s, validVerifier()))
	r.GET("/test", func(c *gin.Context) {
		if v, ok := c.Get("username"); ok {
			ctxUsername, _ = v.(string)
		}
		if v, ok := c.Get("role"); ok {
			ctxRole, _ = v.(string)
		}
		session, _ := c.Get("auth_session")
		ctxSession, _ = session.(*model.AuthSession)
		user, _ := c.Get("user")
		ctxUser, _ = user.(*model.User)
		c.Status(http.StatusOK)
	})

	w := performRequest(r, http.MethodGet, "/test", "valid-token")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", w.Code, w.Body.String())
	}
	if ctxUsername != "testuser" {
		t.Errorf("expected username=%q, got %q", "testuser", ctxUsername)
	}
	if ctxRole != "admin" {
		t.Errorf("expected role=%q, got %q", "admin", ctxRole)
	}
	if ctxSession == nil || ctxSession.ID != 100 {
		t.Fatalf("expected auth session in context, got %+v", ctxSession)
	}
	if ctxUser == nil || ctxUser.Username != "testuser" {
		t.Fatalf("expected user object in context, got %+v", ctxUser)
	}
}

func TestAuth_InvalidBearerDoesNotFallBackToAnonymous(t *testing.T) {
	s := newTestStore(t)
	ResetAnonAccessCache()
	if err := s.SetSetting("anonymous_access", "true"); err != nil {
		t.Fatal(err)
	}

	r := gin.New()
	r.Use(Auth(s, validVerifier()))
	r.GET("/test", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	w := performRequest(r, http.MethodGet, "/test", "bad-token")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d; body: %s", w.Code, w.Body.String())
	}
	var body errs.E
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	if body.Code != errs.NotLoggedIn.Code {
		t.Fatalf("error code = %d, want %d", body.Code, errs.NotLoggedIn.Code)
	}
}

func TestAuth_NoBearerRequiresLogin(t *testing.T) {
	s := newTestStore(t)
	ResetAnonAccessCache()
	if err := s.SetSetting("anonymous_access", "false"); err != nil {
		t.Fatal(err)
	}

	r := gin.New()
	r.Use(Auth(s, validVerifier()))
	r.GET("/test", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	w := performRequest(r, http.MethodGet, "/test", "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d; body: %s", w.Code, w.Body.String())
	}
}

func TestAuth_VerifierError(t *testing.T) {
	s := newTestStore(t)
	ResetAnonAccessCache()
	if err := s.SetSetting("anonymous_access", "false"); err != nil {
		t.Fatal(err)
	}

	r := gin.New()
	r.Use(Auth(s, stubAuthVerifier{err: errors.New("lookup failed")}))
	r.GET("/test", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	w := performRequest(r, http.MethodGet, "/test", "valid-token")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d; body: %s", w.Code, w.Body.String())
	}
}

func TestAuth_SettingReadFailure(t *testing.T) {
	s := newTestStore(t)
	ResetAnonAccessCache()
	if err := s.Close(); err != nil {
		t.Fatalf("Close store: %v", err)
	}

	r := gin.New()
	r.Use(Auth(s, nil))
	r.GET("/test", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	w := performRequest(r, http.MethodGet, "/test", "")
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d; body: %s", w.Code, w.Body.String())
	}
}

func TestOptionalAuth(t *testing.T) {
	r := gin.New()
	r.Use(OptionalAuth(validVerifier()))
	r.GET("/test", func(c *gin.Context) {
		username, _ := c.Get("username")
		role, _ := c.Get("role")
		session, _ := c.Get("auth_session")
		c.JSON(http.StatusOK, gin.H{"username": username, "role": role, "session": session != nil})
	})

	w := performRequest(r, http.MethodGet, "/test", "valid-token")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var body struct {
		Username string `json:"username"`
		Role     string `json:"role"`
		Session  bool   `json:"session"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Username != "testuser" || body.Role != "admin" || !body.Session {
		t.Fatalf("unexpected optional auth body: %+v", body)
	}
}

func TestOptionalAuth_AllowsInvalidBearer(t *testing.T) {
	r := gin.New()
	r.Use(OptionalAuth(validVerifier()))
	r.GET("/test", func(c *gin.Context) {
		_, exists := c.Get("username")
		c.JSON(http.StatusOK, gin.H{"authenticated": exists})
	})

	w := performRequest(r, http.MethodGet, "/test", "bad-token")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var body struct {
		Authenticated bool `json:"authenticated"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Authenticated {
		t.Fatal("invalid bearer token should not set user context")
	}
}

func TestAdminOnly_Admin(t *testing.T) {
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("role", "admin")
		c.Next()
	})
	r.Use(AdminOnly())
	r.GET("/test", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	w := performRequest(r, http.MethodGet, "/test", "")
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestAdminOnly_NonAdmin(t *testing.T) {
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("role", "user")
		c.Next()
	})
	r.Use(AdminOnly())
	r.GET("/test", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	w := performRequest(r, http.MethodGet, "/test", "")
	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", w.Code)
	}

	var body errs.E
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	if body.Message != "admin access required" {
		t.Errorf("unexpected error message: %q", body.Message)
	}
	if body.Code != errs.Blocked.Code {
		t.Errorf("unexpected error code: %d", body.Code)
	}
}

func TestAdminOnly_NoRole(t *testing.T) {
	r := gin.New()
	r.Use(AdminOnly())
	r.GET("/test", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	w := performRequest(r, http.MethodGet, "/test", "")
	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", w.Code)
	}
}

func TestCORS(t *testing.T) {
	r := gin.New()
	r.Use(CORS())
	r.GET("/test", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	t.Run("RegularRequest", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set("Origin", "http://localhost:8080")
		req.Host = "localhost:8080"
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", w.Code)
		}
		if got := w.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:8080" {
			t.Errorf("Allow-Origin: expected %q, got %q", "http://localhost:8080", got)
		}
		if got := w.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
			t.Errorf("Allow-Credentials: expected %q, got %q", "true", got)
		}
		if got := w.Header().Get("Access-Control-Allow-Methods"); got == "" {
			t.Error("Allow-Methods header is missing")
		}
		if got := w.Header().Get("Access-Control-Allow-Headers"); got == "" {
			t.Error("Allow-Headers header is missing")
		}
		if got := w.Header().Get("Access-Control-Max-Age"); got != "86400" {
			t.Errorf("Max-Age: expected %q, got %q", "86400", got)
		}
	})

	t.Run("PreflightOPTIONS", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodOptions, "/test", nil)
		req.Header.Set("Origin", "http://localhost:8080")
		req.Host = "localhost:8080"
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusNoContent {
			t.Errorf("expected 204, got %d", w.Code)
		}
		if got := w.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:8080" {
			t.Errorf("Allow-Origin: expected %q, got %q", "http://localhost:8080", got)
		}
	})

	t.Run("NoOriginHeader", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", w.Code)
		}
		if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
			t.Errorf("Allow-Origin should be empty without Origin header, got %q", got)
		}
		if got := w.Header().Get("Access-Control-Allow-Credentials"); got != "" {
			t.Errorf("Allow-Credentials should be empty without Origin header, got %q", got)
		}
	})
}

func TestCORS_DisallowedOrigin(t *testing.T) {
	r := gin.New()
	r.Use(CORS())
	r.GET("/test", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Origin", "http://evil.com")
	req.Host = "myapp.com"
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("Allow-Origin should be empty for disallowed origin, got %q", got)
	}
}

func TestIsAllowedOriginEdges(t *testing.T) {
	tests := []struct {
		name        string
		origin      string
		requestHost string
		want        bool
	}{
		{name: "invalid origin", origin: "http://[::1", requestHost: "example.com", want: false},
		{name: "same host without request port", origin: "https://app.example", requestHost: "app.example", want: true},
		{name: "ipv6 localhost", origin: "http://[::1]:3000", requestHost: "example.com", want: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isAllowedOrigin(tt.origin, tt.requestHost); got != tt.want {
				t.Fatalf("isAllowedOrigin() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestMaxBodySize(t *testing.T) {
	r := gin.New()
	r.Use(MaxBodySize(4))
	r.POST("/test", func(c *gin.Context) {
		data, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.String(http.StatusRequestEntityTooLarge, err.Error())
			return
		}
		c.String(http.StatusOK, string(data))
	})

	req := httptest.NewRequest(http.MethodPost, "/test", strings.NewReader("12345"))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", w.Code)
	}
}

func TestGinLogger(t *testing.T) {
	r := gin.New()
	r.Use(GinLogger())
	r.GET("/test", func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})

	w := performRequest(r, http.MethodGet, "/test", "")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
}

func TestGinLoggerStatusBranchesAndSkip(t *testing.T) {
	r := gin.New()
	r.Use(GinLogger("/skip"))
	r.GET("/skip", func(c *gin.Context) {
		c.String(http.StatusOK, "skip")
	})
	r.GET("/bad", func(c *gin.Context) {
		c.String(http.StatusBadRequest, "bad")
	})
	r.GET("/error", func(c *gin.Context) {
		_ = c.Error(errors.New("private failure"))
		c.String(http.StatusInternalServerError, "error")
	})

	for _, path := range []string{"/skip", "/bad", "/error"} {
		w := performRequest(r, http.MethodGet, path, "")
		if w.Code == http.StatusNotFound {
			t.Fatalf("%s unexpectedly returned 404", path)
		}
	}
}
