package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
)

func isValidRole(role string) bool {
	return role == "admin" || role == "user"
}

type createUserRequest struct {
	Username          string `json:"username" binding:"required"`
	Password          string `json:"password" binding:"required"`
	Role              string `json:"role" binding:"required"`
	AllowAdultContent bool   `json:"allow_adult_content"`
}

type updateUserRequest struct {
	Username          string `json:"username" binding:"required"`
	Password          string `json:"password"`
	Role              string `json:"role" binding:"required"`
	AllowAdultContent *bool  `json:"allow_adult_content"`
}

// ListUsers returns all users.
// ListUsers 返回所有用户.
func (h *Handler) ListUsers(c *gin.Context) {
	users, err := h.store.ListUsers()
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to list users"))
		return
	}
	c.JSON(http.StatusOK, gin.H{"users": users})
}

// CreateUser creates a new user.
// CreateUser 创建一个新用户.
func (h *Handler) CreateUser(c *gin.Context) {
	var req createUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidRequest)
		return
	}
	if !isValidRole(req.Role) {
		c.JSON(http.StatusBadRequest, errs.InvalidRole)
		return
	}
	if strings.TrimSpace(req.Username) == "" || strings.TrimSpace(req.Password) == "" {
		c.JSON(http.StatusBadRequest, errs.MissingFields.WithMsg("username and password must not be empty"))
		return
	}

	id, err := h.store.CreateUserWithAdultAccess(req.Username, req.Password, req.Role, req.AllowAdultContent)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to create user"))
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"id":                  id,
		"username":            req.Username,
		"role":                req.Role,
		"allow_adult_content": req.AllowAdultContent,
	})
}

// UpdateUser updates an existing user.
// UpdateUser 更新已有用户.
func (h *Handler) UpdateUser(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidID.WithMsg("invalid user id"))
		return
	}

	var req updateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidRequest)
		return
	}
	if req.Role != "" && !isValidRole(req.Role) {
		c.JSON(http.StatusBadRequest, errs.InvalidRole)
		return
	}

	target, err := h.store.GetUserByID(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to look up user"))
		return
	}
	if target == nil {
		c.JSON(http.StatusNotFound, errs.NotFound.WithMsg("user not found"))
		return
	}
	allowAdultContent := target.AllowAdultContent
	if req.AllowAdultContent != nil {
		allowAdultContent = *req.AllowAdultContent
	}

	// Prevent demoting the last admin to a regular user.
	// 防止把最后一个管理员降级为普通用户.
	if req.Role == "user" {
		if target.Role == "admin" {
			count, err := h.store.CountAdminUsers()
			if err != nil {
				c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to count admins"))
				return
			}
			if count <= 1 {
				c.JSON(http.StatusForbidden, errs.LastAdmin.WithMsg("cannot demote the last admin"))
				return
			}
		}
	}

	if err := h.store.UpdateUserFullWithAdultAccess(id, req.Username, req.Role, req.Password, allowAdultContent); err != nil {
		if errors.Is(err, errs.ErrNotFound) {
			c.JSON(http.StatusNotFound, errs.NotFound.WithMsg("user not found"))
			return
		}
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to update user"))
		return
	}
	if strings.TrimSpace(req.Password) != "" {
		// Password changes invalidate all existing bearer tokens.
		// 密码变更会使该用户现有 bearer token 全部失效.
		if err := h.authSvc.RevokeUserAccessTokens(id); err != nil {
			c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to revoke user tokens"))
			return
		}
	} else if target.AllowAdultContent && !allowAdultContent {
		// Adult-content downgrades must take effect immediately for bearer tokens.
		// 成人内容访问降级必须对 bearer token 立即生效.
		if err := h.authSvc.RevokeUserAccessTokens(id); err != nil {
			c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to revoke user tokens"))
			return
		}
	} else {
		// Role or username changes must not keep stale cached user snapshots.
		// 角色或用户名变更不能保留过期的用户快照缓存.
		h.authSvc.InvalidateUserCache(id)
	}

	c.JSON(http.StatusOK, gin.H{"message": "user updated"})
}

// DeleteUser deletes a user.
// DeleteUser 删除用户.
func (h *Handler) DeleteUser(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidID.WithMsg("invalid user id"))
		return
	}

	// Prevent admin from deleting themselves.
	// 防止管理员删除自己.
	if u, ok := c.Get("user"); ok {
		if currentUser, ok := u.(*model.User); ok && currentUser.ID == id {
			c.JSON(http.StatusForbidden, errs.SelfDelete)
			return
		}
	}

	// Prevent deleting the last admin user.
	// 防止删除最后一个管理员用户.
	target, err := h.store.GetUserByID(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to look up user"))
		return
	}
	if target == nil {
		c.JSON(http.StatusNotFound, errs.NotFound.WithMsg("user not found"))
		return
	}
	if target.Role == "admin" {
		count, err := h.store.CountAdminUsers()
		if err != nil {
			c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to count admins"))
			return
		}
		if count <= 1 {
			c.JSON(http.StatusForbidden, errs.LastAdmin.WithMsg("cannot delete the last admin user"))
			return
		}
	}

	// Deleted users must not keep usable bearer tokens.
	// 被删除用户不能保留仍可使用的 bearer token.
	if err := h.authSvc.RevokeUserAccessTokens(id); err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to revoke user tokens"))
		return
	}

	if err := h.store.DeleteUser(id); err != nil {
		if errors.Is(err, errs.ErrNotFound) {
			c.JSON(http.StatusNotFound, errs.NotFound.WithMsg("user not found"))
			return
		}
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to delete user"))
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "user deleted"})
}
