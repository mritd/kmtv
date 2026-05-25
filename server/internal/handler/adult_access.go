package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/mritd/kmtv/internal/consts"
	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
)

func (h *Handler) nsfwFilterEnabled() (bool, error) {
	value, err := h.store.GetSetting(consts.SettingNSFWFilterEnabled)
	if err != nil {
		return false, err
	}
	return value == "true", nil
}

func (h *Handler) currentUserAllowsAdultContent(c *gin.Context) bool {
	user := h.currentUser(c)
	return user != nil && user.AllowAdultContent
}

func (h *Handler) shouldFilterAdult(c *gin.Context) bool {
	enabled, err := h.nsfwFilterEnabled()
	if err != nil {
		return true
	}
	return enabled || !h.currentUserAllowsAdultContent(c)
}

func (h *Handler) requireSourceAccess(c *gin.Context, src *model.Source) bool {
	if src == nil || !src.IsAdult {
		return true
	}
	enabled, err := h.nsfwFilterEnabled()
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to read adult content setting"))
		return false
	}
	if enabled || !h.currentUserAllowsAdultContent(c) {
		c.JSON(http.StatusForbidden, errs.Blocked.WithMsg("adult content access denied"))
		return false
	}
	return true
}
