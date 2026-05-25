package handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestLogin_Success(t *testing.T) {
	h, r := setupTestHandler(t)
	createTestUser(t, h, "alice", "pass123", "admin")

	body, _ := json.Marshal(map[string]string{"username": "alice", "password": "pass123"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	m := decodeJSON(t, rec)
	if m["username"] != "alice" {
		t.Errorf("expected username alice, got %v", m["username"])
	}
	if m["role"] != "admin" {
		t.Errorf("expected role admin, got %v", m["role"])
	}
	if m["id"] == nil {
		t.Error("expected id in response")
	}
	if m["avatar"] != nil {
		t.Errorf("expected no avatar for new user, got %v", m["avatar"])
	}

	if token, ok := m["access_token"].(string); !ok || token == "" {
		t.Fatalf("expected access_token in response, got %+v", m)
	}
	if expiresAt, ok := m["expires_at"].(string); !ok || expiresAt == "" {
		t.Fatalf("expected expires_at in response, got %+v", m)
	}
}

func TestLogin_InvalidCredentials(t *testing.T) {
	h, r := setupTestHandler(t)
	createTestUser(t, h, "bob", "correct", "user")

	body, _ := json.Marshal(map[string]string{"username": "bob", "password": "wrong"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestLogin_MissingFields(t *testing.T) {
	_, r := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader([]byte("{}")))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestLoginReportsStoreLookupFailure(t *testing.T) {
	h, r := setupTestHandler(t)
	if err := h.store.Close(); err != nil {
		t.Fatalf("Close store: %v", err)
	}

	body, _ := json.Marshal(map[string]string{"username": "closed", "password": "pass"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 lookup failure, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestMe_ValidBearer(t *testing.T) {
	h, r := setupTestHandler(t)
	createTestUser(t, h, "carol", "secret", "user")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", adminBearer(t, h, "carol"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	m := decodeJSON(t, rec)
	if m["username"] != "carol" {
		t.Errorf("expected username carol, got %v", m["username"])
	}
	if m["role"] != "user" {
		t.Errorf("expected role user, got %v", m["role"])
	}
	if m["id"] == nil {
		t.Error("expected id in response")
	}
	if m["avatar"] != nil {
		t.Errorf("expected no avatar for new user, got %v", m["avatar"])
	}
}

func TestMeIncludesAvatarForBearerUser(t *testing.T) {
	h, r := setupTestHandler(t)
	userID := createTestUser(t, h, "me_avatar", "secret", "user")
	if err := h.store.UpdateAvatar(userID, "data:image/png;base64,aGVsbG8="); err != nil {
		t.Fatalf("UpdateAvatar: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", adminBearer(t, h, "me_avatar"))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	m := decodeJSON(t, rec)
	if m["avatar"] != "/api/v1/avatar/me_avatar" {
		t.Fatalf("unexpected avatar in me response: %+v", m)
	}
}

func TestMe_NoBearer(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestMe_Anonymous(t *testing.T) {
	_, r := setupTestHandler(t)
	// anonymous_access defaults to "true"

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp["username"] != "anonymous" {
		t.Fatalf("expected anonymous user, got %v", resp["username"])
	}
}

func TestLogout(t *testing.T) {
	h, r := setupTestHandler(t)
	createTestUser(t, h, "logout_user", "pass", "user")
	bearer := loginAndGetBearer(t, r, "logout_user", "pass")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	req.Header.Set("Authorization", bearer)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", bearer)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected anonymous fallback after logout, got %d: %s", rec.Code, rec.Body.String())
	}
	m := decodeJSON(t, rec)
	if m["username"] != "anonymous" {
		t.Fatalf("expected anonymous after revoked token with anonymous access, got %+v", m)
	}
}

func TestLogoutWithoutBearer(t *testing.T) {
	_, r := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 without bearer, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestLogoutReportsRevokeFailure(t *testing.T) {
	h, r := setupTestHandler(t)
	createTestUser(t, h, "logout_error", "pass", "user")
	bearer := loginAndGetBearer(t, r, "logout_error", "pass")
	if err := h.store.Close(); err != nil {
		t.Fatalf("Close store: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	req.Header.Set("Authorization", bearer)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 revoke failure, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestLoginIncludesAvatar(t *testing.T) {
	h, r := setupTestHandler(t)
	userID := createTestUser(t, h, "avatar_login", "pass", "user")
	if err := h.store.UpdateAvatar(userID, "data:image/png;base64,aGVsbG8="); err != nil {
		t.Fatalf("UpdateAvatar: %v", err)
	}

	body, _ := json.Marshal(map[string]string{"username": "avatar_login", "password": "pass"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	m := decodeJSON(t, rec)
	if m["avatar"] != "/api/v1/avatar/avatar_login" {
		t.Fatalf("unexpected avatar path: %+v", m)
	}
}

func TestProfileAndPasswordValidationErrors(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	createTestUser(t, h, "profile_validation", "oldpass", "user")
	bearer := loginAndGetBearer(t, r, "profile_validation", "oldpass")

	req := httptest.NewRequest(http.MethodPut, "/api/v1/auth/profile", bytes.NewReader([]byte(`{`)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearer)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 invalid profile body, got %d: %s", rec.Code, rec.Body.String())
	}

	body, _ := json.Marshal(map[string]string{"username": ""})
	req = httptest.NewRequest(http.MethodPut, "/api/v1/auth/profile", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearer)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 invalid username, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodPut, "/api/v1/auth/password", bytes.NewReader([]byte(`{`)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearer)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 invalid password body, got %d: %s", rec.Code, rec.Body.String())
	}

	body, _ = json.Marshal(map[string]string{"old_password": "wrong", "new_password": "newpass"})
	req = httptest.NewRequest(http.MethodPut, "/api/v1/auth/password", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearer)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 incorrect old password, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUpdateProfileIncludesAvatar(t *testing.T) {
	h, r := setupTestHandler(t)
	disableAnonymousAccess(t, h)
	userID := createTestUser(t, h, "profile_avatar", "pass", "user")
	if err := h.store.UpdateAvatar(userID, "data:image/png;base64,aGVsbG8="); err != nil {
		t.Fatalf("UpdateAvatar: %v", err)
	}
	bearer := loginAndGetBearer(t, r, "profile_avatar", "pass")

	body, _ := json.Marshal(map[string]string{"username": "profile_avatar_new"})
	req := httptest.NewRequest(http.MethodPut, "/api/v1/auth/profile", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearer)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	m := decodeJSON(t, rec)
	if m["avatar"] != "/api/v1/avatar/profile_avatar_new" {
		t.Fatalf("unexpected avatar path after profile update: %+v", m)
	}
}

func TestAuthHandlerStoreFailures(t *testing.T) {
	h, _ := setupTestHandler(t)
	userID := createTestUser(t, h, "auth_store_failure", "oldpass", "user")
	user, err := h.store.GetUserByID(userID)
	if err != nil {
		t.Fatalf("GetUserByID: %v", err)
	}
	if err := h.store.Close(); err != nil {
		t.Fatalf("Close store: %v", err)
	}

	tests := map[string]gin.HandlerFunc{
		"update profile":  h.UpdateProfile,
		"change password": h.ChangePassword,
		"upload avatar":   h.UploadAvatar,
		"delete avatar":   h.DeleteAvatar,
		"get avatar":      h.GetAvatar,
	}
	for name, handler := range tests {
		t.Run(name, func(t *testing.T) {
			var body *bytes.Reader
			switch name {
			case "update profile":
				body = bytes.NewReader([]byte(`{"username":"after_close"}`))
			case "change password":
				body = bytes.NewReader([]byte(`{"old_password":"oldpass","new_password":"newpass"}`))
			default:
				body = bytes.NewReader(nil)
			}
			rec := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(rec)
			c.Request = httptest.NewRequest(http.MethodPost, "/test", body)
			c.Request.Header.Set("Content-Type", "application/json")
			c.Set("user", user)
			if name == "upload avatar" {
				var upload bytes.Buffer
				writer := multipart.NewWriter(&upload)
				part, err := writer.CreateFormFile("avatar", "avatar.png")
				if err != nil {
					t.Fatalf("CreateFormFile: %v", err)
				}
				_, _ = part.Write([]byte{
					0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
					0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
					0x00, 0x00, 0x00, 0x01,
				})
				if err := writer.Close(); err != nil {
					t.Fatalf("close multipart: %v", err)
				}
				c.Request = httptest.NewRequest(http.MethodPut, "/test", &upload)
				c.Request.Header.Set("Content-Type", writer.FormDataContentType())
				c.Set("user", user)
			}
			if name == "get avatar" {
				c.Params = gin.Params{{Key: "username", Value: "auth_store_failure"}}
			}
			handler(c)
			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want 500: %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestProtectedAuthHandlersRejectMissingContextUser(t *testing.T) {
	h, _ := setupTestHandler(t)
	handlers := map[string]gin.HandlerFunc{
		"update profile":  h.UpdateProfile,
		"change password": h.ChangePassword,
		"upload avatar":   h.UploadAvatar,
		"delete avatar":   h.DeleteAvatar,
	}
	for name, handler := range handlers {
		t.Run(name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(rec)
			c.Request = httptest.NewRequest(http.MethodPost, "/test", bytes.NewReader([]byte(`{}`)))
			handler(c)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401: %s", rec.Code, rec.Body.String())
			}
		})
	}
}

// uploadAvatarHTTP uploads a tiny valid PNG via the real HTTP stack and returns the response.
// uploadAvatarHTTP 通过真实 HTTP 栈上传一张极小的合法 PNG 并返回响应.
func uploadAvatarHTTP(t *testing.T, r *gin.Engine, bearer string) *httptest.ResponseRecorder {
	t.Helper()
	var upload bytes.Buffer
	writer := multipart.NewWriter(&upload)
	part, err := writer.CreateFormFile("avatar", "avatar.png")
	if err != nil {
		t.Fatalf("CreateFormFile: %v", err)
	}
	// Minimal PNG header so http.DetectContentType returns image/png.
	// 最小 PNG 头, 使 http.DetectContentType 返回 image/png.
	_, _ = part.Write([]byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01,
	})
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart: %v", err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/auth/avatar", &upload)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", bearer)
	r.ServeHTTP(rec, req)
	return rec
}

// TestUpdateProfilePreservesAvatarAfterUpload guards against the cached bearer snapshot
// going stale after an avatar upload, which previously made the next profile save drop the
// avatar from its response. The test must drive the real Auth middleware so the cache is exercised.
// TestUpdateProfilePreservesAvatarAfterUpload 防止头像上传后 bearer 缓存快照变陈旧,
// 此前会导致下一次保存 profile 时响应丢失头像. 测试必须经过真实 Auth middleware 才能命中缓存路径.
func TestUpdateProfilePreservesAvatarAfterUpload(t *testing.T) {
	h, r := setupTestHandler(t)
	createTestUser(t, h, "alice", "pass123", "user")
	disableAnonymousAccess(t, h)
	bearer := loginAndGetBearer(t, r, "alice", "pass123")

	// Upload an avatar; the response should advertise it.
	// 上传头像; 响应应包含头像地址.
	rec := uploadAvatarHTTP(t, r, bearer)
	if rec.Code != http.StatusOK {
		t.Fatalf("upload avatar status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if got := decodeJSON(t, rec)["avatar"]; got != "/api/v1/avatar/alice" {
		t.Fatalf("upload avatar response avatar = %v, want /api/v1/avatar/alice", got)
	}

	// Saving the profile must keep the avatar, tracking the (possibly renamed) username.
	// 保存 profile 时必须保留头像, 并跟随 (可能变更的) 用户名.
	body, _ := json.Marshal(map[string]string{"username": "alice2"})
	rec = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/auth/profile", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearer)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("update profile status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if got := decodeJSON(t, rec)["avatar"]; got != "/api/v1/avatar/alice2" {
		t.Fatalf("update profile dropped avatar: got %v, want /api/v1/avatar/alice2", got)
	}
}

// TestUpdateProfileReflectsAvatarDeletion is the symmetric guard: after deleting the avatar,
// the cached snapshot must not resurrect it on the next profile save.
// TestUpdateProfileReflectsAvatarDeletion 是对称防护: 删除头像后, 缓存快照不能在下一次保存 profile 时复活它.
func TestUpdateProfileReflectsAvatarDeletion(t *testing.T) {
	h, r := setupTestHandler(t)
	createTestUser(t, h, "bob", "pass123", "user")
	disableAnonymousAccess(t, h)
	bearer := loginAndGetBearer(t, r, "bob", "pass123")

	if rec := uploadAvatarHTTP(t, r, bearer); rec.Code != http.StatusOK {
		t.Fatalf("upload avatar status = %d, want 200: %s", rec.Code, rec.Body.String())
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/auth/avatar", nil)
	req.Header.Set("Authorization", bearer)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete avatar status = %d, want 200: %s", rec.Code, rec.Body.String())
	}

	body, _ := json.Marshal(map[string]string{"username": "bob"})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPut, "/api/v1/auth/profile", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearer)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("update profile status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if _, ok := decodeJSON(t, rec)["avatar"]; ok {
		t.Fatal("update profile resurrected deleted avatar")
	}
}

// ---------- Admin handler tests ----------
