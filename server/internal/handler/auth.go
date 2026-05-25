package handler

import (
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/mritd/kmtv/internal/consts"
	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
	appruntime "github.com/mritd/kmtv/internal/runtime"
	"github.com/mritd/kmtv/internal/store"
	"github.com/mritd/kmtv/internal/utils"
)

type loginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

// Login verifies credentials and issues an opaque bearer token.
// Login 校验凭据并签发 opaque bearer token.
func (h *Handler) Login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidRequest)
		return
	}

	user, err := h.store.GetUserByUsername(req.Username)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to look up user"))
		return
	}
	if user == nil || !store.CheckPassword(user.Password, req.Password) {
		c.JSON(http.StatusUnauthorized, errs.InvalidCredentials)
		return
	}

	issued, err := h.authSvc.IssueAccessToken(
		user,
		time.Duration(appruntime.Default().AccessTokenTTL())*time.Second,
		c.Request.UserAgent(),
		c.ClientIP(),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to issue token"))
		return
	}
	resp := gin.H{
		"id":           user.ID,
		"username":     user.Username,
		"role":         user.Role,
		"access_token": issued.Token,
		"expires_at":   issued.ExpiresAt.Format(time.RFC3339),
	}
	if user.Avatar != "" {
		resp["avatar"] = "/api/v1/avatar/" + user.Username
	}
	c.JSON(http.StatusOK, resp)
}

// Logout revokes the current bearer token when one is provided.
// Logout 在请求包含 bearer token 时注销当前 token.
func (h *Handler) Logout(c *gin.Context) {
	if token := utils.ExtractBearerToken(c.GetHeader("Authorization")); token != "" {
		if err := h.authSvc.RevokeAccessToken(token); err != nil {
			c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to logout"))
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"message": "logged out"})
}

// Me returns the current user's info based on bearer auth.
// If anonymous access is enabled and no valid bearer token exists, returns an anonymous user.
// Me 根据 bearer auth 返回当前用户信息.
// 如果启用匿名访问且没有有效 bearer token, 则返回匿名用户.
func (h *Handler) Me(c *gin.Context) {
	if token := utils.ExtractBearerToken(c.GetHeader("Authorization")); token != "" {
		if _, user, err := h.authSvc.VerifyAccessToken(token); err == nil && user != nil {
			resp := gin.H{"id": user.ID, "username": user.Username, "role": user.Role}
			if user.Avatar != "" {
				resp["avatar"] = "/api/v1/avatar/" + user.Username
			}
			c.JSON(http.StatusOK, resp)
			return
		}
	}

	// No valid bearer token, check anonymous access.
	// 没有有效 bearer token 时检查匿名访问.
	if anonAccess, _ := h.store.GetSetting(consts.SettingAnonymousAccess); anonAccess == "true" {
		c.JSON(http.StatusOK, gin.H{"id": 0, "username": "anonymous", "role": "user"})
		return
	}

	c.JSON(http.StatusUnauthorized, errs.NotLoggedIn)
}

// UpdateProfile allows the logged-in user to update their own username.
// UpdateProfile 允许已登录用户更新自己的用户名.
func (h *Handler) UpdateProfile(c *gin.Context) {
	user := h.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, errs.NotLoggedIn)
		return
	}

	var req struct {
		Username string `json:"username" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidRequest)
		return
	}

	newUsername := strings.TrimSpace(req.Username)
	if err := h.store.UpdateUsername(user.ID, newUsername); err != nil {
		if errors.Is(err, errs.ErrUsernameTaken) {
			c.JSON(http.StatusConflict, errs.UsernameTaken)
			return
		}
		if errors.Is(err, errs.ErrInvalidUsername) {
			c.JSON(http.StatusBadRequest, errs.InvalidRequest.WithMsg(err.Error()))
			return
		}
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to update username"))
		return
	}
	// Username changes must invalidate cached bearer user snapshots.
	// 用户名变更必须清理 bearer 用户快照缓存.
	h.authSvc.InvalidateUserCache(user.ID)

	resp := gin.H{"id": user.ID, "username": newUsername, "role": user.Role}
	if user.Avatar != "" {
		resp["avatar"] = "/api/v1/avatar/" + newUsername
	}
	c.JSON(http.StatusOK, resp)
}

// currentUser extracts the authenticated user from the gin context.
// It requires the Auth middleware to have run.
// currentUser 从 gin context 中提取已认证用户.
// 它要求 Auth middleware 已经执行.
func (h *Handler) currentUser(c *gin.Context) *model.User {
	v, exists := c.Get("user")
	if !exists {
		return nil
	}
	u, _ := v.(*model.User)
	return u
}

// ChangePassword allows the logged-in user to change their password.
// ChangePassword 允许已登录用户修改密码.
func (h *Handler) ChangePassword(c *gin.Context) {
	user := h.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, errs.NotLoggedIn)
		return
	}

	var req struct {
		OldPassword string `json:"old_password" binding:"required"`
		NewPassword string `json:"new_password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidRequest)
		return
	}

	if !store.CheckPassword(user.Password, req.OldPassword) {
		c.JSON(http.StatusUnauthorized, errs.IncorrectPassword)
		return
	}

	if err := h.store.UpdateUserPassword(user.ID, req.NewPassword); err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to update password"))
		return
	}
	if err := h.authSvc.RevokeUserAccessTokens(user.ID); err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to revoke tokens"))
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "password updated"})
}

// allowedAvatarTypes lists the content types accepted for avatar uploads.
// allowedAvatarTypes 列出头像上传接受的 content type.
var allowedAvatarTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/gif":  true,
	"image/webp": true,
}

// UploadAvatar handles avatar image upload for the logged-in user.
// UploadAvatar 处理已登录用户的头像图片上传.
func (h *Handler) UploadAvatar(c *gin.Context) {
	user := h.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, errs.NotLoggedIn)
		return
	}

	file, header, err := c.Request.FormFile("avatar")
	if err != nil {
		c.JSON(http.StatusBadRequest, errs.MissingAvatar)
		return
	}
	defer func() { _ = file.Close() }()

	// Max 256KB.
	// 最大 256KB.
	if header.Size > 256*1024 {
		c.JSON(http.StatusBadRequest, errs.FileTooLarge)
		return
	}

	data, err := io.ReadAll(io.LimitReader(file, 256*1024+1))
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to read file"))
		return
	}
	if len(data) > 256*1024 {
		c.JSON(http.StatusBadRequest, errs.FileTooLarge)
		return
	}

	// Detect actual content type from file bytes instead of trusting client header.
	// 从文件字节检测真实 content type, 而不是信任客户端 header.
	contentType := http.DetectContentType(data)
	if !allowedAvatarTypes[contentType] {
		c.JSON(http.StatusBadRequest, errs.UnsupportedImageType)
		return
	}

	encoded := base64.StdEncoding.EncodeToString(data)
	dataURL := "data:" + contentType + ";base64," + encoded

	if err := h.store.UpdateAvatar(user.ID, dataURL); err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to save avatar"))
		return
	}
	// Drop the cached bearer snapshot so later requests (e.g. UpdateProfile) see the new avatar.
	// 清理 bearer 缓存快照, 使后续请求 (如 UpdateProfile) 能读到新头像.
	h.authSvc.InvalidateUserCache(user.ID)

	c.JSON(http.StatusOK, gin.H{
		"id":       user.ID,
		"username": user.Username,
		"role":     user.Role,
		"avatar":   "/api/v1/avatar/" + user.Username,
	})
}

// DeleteAvatar removes the avatar for the logged-in user.
// DeleteAvatar 删除已登录用户的头像.
func (h *Handler) DeleteAvatar(c *gin.Context) {
	user := h.currentUser(c)
	if user == nil {
		c.JSON(http.StatusUnauthorized, errs.NotLoggedIn)
		return
	}

	if err := h.store.DeleteAvatar(user.ID); err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to delete avatar"))
		return
	}
	// Drop the cached bearer snapshot so later requests no longer see the removed avatar.
	// 清理 bearer 缓存快照, 使后续请求不再读到已删除的头像.
	h.authSvc.InvalidateUserCache(user.ID)

	c.JSON(http.StatusOK, gin.H{
		"id":       user.ID,
		"username": user.Username,
		"role":     user.Role,
	})
}

// GetAvatar serves the avatar image for the given username.
// GetAvatar 返回指定用户名的头像图片.
func (h *Handler) GetAvatar(c *gin.Context) {
	username := c.Param("username")
	if username == "" {
		c.JSON(http.StatusBadRequest, errs.InvalidRequest.WithMsg("username is required"))
		return
	}

	dataURL, err := h.store.GetAvatar(username)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to get avatar"))
		return
	}
	if dataURL == "" {
		c.JSON(http.StatusNotFound, errs.NoAvatar)
		return
	}

	// Parse data URL: "data:<content-type>;base64,<data>".
	// 解析 data URL: "data:<content-type>;base64,<data>".
	if !strings.HasPrefix(dataURL, "data:") {
		c.JSON(http.StatusInternalServerError, errs.InvalidData)
		return
	}
	parts := strings.SplitN(dataURL[5:], ";base64,", 2)
	if len(parts) != 2 {
		c.JSON(http.StatusInternalServerError, errs.InvalidData)
		return
	}

	contentType := parts[0]
	decoded, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.InvalidData)
		return
	}

	c.Header("Cache-Control", "public, max-age=3600")
	c.Data(http.StatusOK, contentType, decoded)
}
